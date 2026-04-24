import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CircuitBreakerService, CircuitOpenError } from '../safety/circuit-breaker.service';
import { SafetyBlockedError, SafetyModeService } from '../safety/safety-mode.service';
import type { Capability } from '../safety/capability-matrix';
import { EmailProvider } from './email.provider';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import {
  AmbiguousOutcome,
  ClientError,
  ConfigError,
  ProviderError,
  TransientInfraError,
  classify,
} from './error-classifier';

export type DispatchChannel = 'email' | 'sms' | 'voice';

export interface SecureLink {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: Date;
}

export interface DispatchSpec {
  idempotencyKey: string;
  releaseActionId: string | null;
  channel: DispatchChannel;
  to: string;
  // Pre-decrypted payload. Comes from VaultDecryptor (chokepoint). The
  // adapter NEVER pulls plaintext from anywhere else.
  subject?: string;
  body: string;
  // Optional one-time recipient links to attachments. The adapter renders a
  // plain-text block under the body (per channel) so individual provider
  // classes don't need to know about links.
  secureLinks?: SecureLink[];
}

/**
 * The PROVIDER CHOKEPOINT.
 *
 * Every outbound send in the codebase must go through ProviderAdapter.send().
 * Raw EmailProvider / SmsProvider / VoiceProvider are treated as internals;
 * they are injected here but NOT re-exported from ProvidersModule's public
 * surface (see providers.module.ts).
 *
 * Guarantees:
 *  - safety.assert(capability) for the exact channel.
 *  - Circuit breaker assertClosed + provider isolation check.
 *  - OutboundDispatch idempotency row reserved before any provider call.
 *  - All provider-specific errors are classified into ProviderError types;
 *    the breaker is updated accordingly.
 */
@Injectable()
export class ProviderAdapter {
  private readonly log = new Logger(ProviderAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly breakers: CircuitBreakerService,
    private readonly safety: SafetyModeService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    private readonly voice: VoiceProvider,
  ) {}

  async send(spec: DispatchSpec): Promise<{ provider: string; providerMessageId: string; reused: boolean }> {
    const { channel, idempotencyKey } = spec;
    const capability = capabilityFor(channel);
    const providerKey = providerKeyFor(channel);

    // Chokepoint step 1 — global policy.
    await this.safety.assert(capability);

    // Chokepoint step 2 — per-provider breaker + isolation.
    try {
      await this.breakers.assertClosed(providerKey);
    } catch (e) {
      if (e instanceof CircuitOpenError) {
        throw new TransientInfraError(`circuit open: ${providerKey}`);
      }
      throw e;
    }

    // Chokepoint step 3 — idempotent reservation.
    try {
      await this.prisma.outboundDispatch.create({
        data: {
          idempotencyKey,
          releaseActionId: spec.releaseActionId ?? undefined,
          provider: providerKey,
          status: 'reserved',
        },
      });
    } catch (err: any) {
      const prior = await this.prisma.outboundDispatch.findUnique({ where: { idempotencyKey } });
      if (!prior) throw err;
      if (prior.status === 'sent' && prior.providerMessageId) {
        return { provider: prior.provider, providerMessageId: prior.providerMessageId, reused: true };
      }
      if (prior.status === 'failed') {
        throw new ClientError(`prior dispatch failed: ${prior.errorMessage ?? 'unknown'}`);
      }
      throw new AmbiguousOutcome(`dispatch ${idempotencyKey} reserved-but-unconfirmed`);
    }

    // Chokepoint step 4 — provider call wrapped to normalize errors.
    try {
      const result = await this.callProvider(spec);
      await this.prisma.outboundDispatch.update({
        where: { idempotencyKey },
        data: { status: 'sent', providerMessageId: result.providerMessageId, completedAt: new Date() },
      });
      await this.breakers.recordSuccess(providerKey);
      return { ...result, reused: false };
    } catch (err) {
      const classified = err instanceof ProviderError ? err : classify(err);
      const persistedStatus = classified.permanent ? 'failed' : 'reserved';
      await this.prisma.outboundDispatch.update({
        where: { idempotencyKey },
        data: {
          status: persistedStatus,
          errorMessage: classified.message.slice(0, 1000),
          completedAt: classified.permanent ? new Date() : null,
        },
      });
      await this.feedBreaker(providerKey, classified);
      throw classified;
    }
  }

  private async callProvider(spec: DispatchSpec): Promise<{ provider: string; providerMessageId: string }> {
    const composed = renderBody(spec);
    switch (spec.channel) {
      case 'email':
        return this.email.send(spec.to, spec.subject ?? '(no subject)', composed, spec.idempotencyKey);
      case 'sms':
        return this.sms.send(spec.to, composed, spec.idempotencyKey);
      case 'voice':
        // Voice scripts read the message body only — links cannot be spoken
        // intelligibly. Fall back to a TTS-friendly hint that an email/SMS
        // contains the secure links, when present.
        return this.voice.call(spec.to, composedForVoice(spec), spec.idempotencyKey);
    }
  }

  private async feedBreaker(providerKey: string, err: ProviderError) {
    switch (err.breakerImpact) {
      case 'failure':
        await this.breakers.recordFailure(providerKey, err.message);
        return;
      case 'ambiguous':
        await this.breakers.recordAmbiguous(providerKey, err.message);
        return;
      case 'isolate_immediately':
        // ConfigError — isolate provider right away; it won't recover without
        // operator attention.
        await this.breakers.recordFailure(providerKey, err.message);
        await this.safety.isolateProvider(providerKey, `config/auth: ${err.message}`, 'system');
        return;
      case 'none':
        return;
    }
  }
}

function capabilityFor(ch: DispatchChannel): Capability {
  switch (ch) {
    case 'email': return 'provider.email_send';
    case 'sms': return 'provider.sms_send';
    case 'voice': return 'provider.voice_call';
  }
}

function providerKeyFor(ch: DispatchChannel): string {
  switch (ch) {
    case 'email': return 'sendgrid';
    case 'sms': return 'twilio-sms';
    case 'voice': return 'twilio-voice';
  }
}

/**
 * Compose the outbound text. v1 is plain text for both email and SMS — no
 * binary attachments. The secure-link block lists each attachment with
 * filename, size, expiry, and one-time URL. Recipients click through to
 * the AttachmentDownloadController which decrypts on the fly.
 */
function renderBody(spec: DispatchSpec): string {
  if (!spec.secureLinks || spec.secureLinks.length === 0) return spec.body;
  const lines = ['', '--- Secure file links ---'];
  for (const link of spec.secureLinks) {
    const sizeKb = Math.max(1, Math.round(link.sizeBytes / 1024));
    lines.push(
      `* ${link.filename} (${link.mimeType}, ~${sizeKb} KB)`,
      `  ${link.url}`,
      `  Expires: ${link.expiresAt.toISOString()}`,
    );
  }
  lines.push('', 'Each link is single-recipient and limited-use. Treat it like a password.');
  return `${spec.body}\n${lines.join('\n')}`;
}

function composedForVoice(spec: DispatchSpec): string {
  if (!spec.secureLinks || spec.secureLinks.length === 0) return spec.body;
  return `${spec.body}\n\nThis release also includes ${spec.secureLinks.length} secure file link(s); please check your email or text messages.`;
}
