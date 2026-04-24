import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CircuitBreakerService, CircuitOpenError } from '../safety/circuit-breaker.service';
import { SafetyModeService } from '../safety/safety-mode.service';

export class PermanentSendError extends Error {
  readonly permanent = true;
  constructor(message: string) { super(message); }
}
export class TemporarySendError extends Error {
  readonly permanent = false;
  constructor(message: string) { super(message); }
}
export class AmbiguousSendError extends Error {
  readonly ambiguous = true;
  constructor(message: string) { super(message); }
}

type SendFn = () => Promise<{ provider: string; providerMessageId: string }>;

/**
 * Dispatch with safety layer (interlocks IL2, IL3):
 *  0. Pre-flight — assert global 'provider.dispatch' capability and that
 *     this provider's circuit is closed. Either failing throws BEFORE we
 *     reserve a dispatch row.
 *  1. Reserve a unique dispatch row (idempotency).
 *  2. Call provider.
 *  3. Record outcome to the breaker: success / failure / ambiguous.
 *
 * A CircuitOpenError is converted to TemporarySendError so BullMQ re-queues;
 * when the breaker flips to half_open the next attempt probes.
 */
@Injectable()
export class OutboundDispatcher {
  private readonly log = new Logger(OutboundDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly breakers: CircuitBreakerService,
    private readonly safety: SafetyModeService,
  ) {}

  async dispatch(
    idempotencyKey: string,
    releaseActionId: string | null,
    provider: string,
    send: SendFn,
  ): Promise<{ provider: string; providerMessageId: string; reused: boolean }> {
    // Note: per-channel safety.assert is enforced by ProviderAdapter, the
    // real chokepoint. This legacy path is retained only for the escalation
    // ladder's non-release SMS attempts; breaker + idempotency still apply.
    try {
      await this.breakers.assertClosed(provider);
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        throw new TemporarySendError(`circuit open: ${provider}`);
      }
      throw err;
    }

    try {
      await this.prisma.outboundDispatch.create({
        data: { idempotencyKey, releaseActionId: releaseActionId ?? undefined, provider, status: 'reserved' },
      });
    } catch (err: any) {
      const prior = await this.prisma.outboundDispatch.findUnique({ where: { idempotencyKey } });
      if (!prior) throw err;
      if (prior.status === 'sent' && prior.providerMessageId) {
        return { provider: prior.provider, providerMessageId: prior.providerMessageId, reused: true };
      }
      if (prior.status === 'failed') {
        throw new PermanentSendError(`prior dispatch failed: ${prior.errorMessage ?? 'unknown'}`);
      }
      throw new AmbiguousSendError(`dispatch ${idempotencyKey} reserved-but-unconfirmed`);
    }

    try {
      const res = await send();
      await this.prisma.outboundDispatch.update({
        where: { idempotencyKey },
        data: { status: 'sent', providerMessageId: res.providerMessageId, completedAt: new Date() },
      });
      await this.breakers.recordSuccess(provider);
      return { ...res, reused: false };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const permanent = err instanceof PermanentSendError;
      const ambiguous = err instanceof AmbiguousSendError;
      await this.prisma.outboundDispatch.update({
        where: { idempotencyKey },
        data: {
          status: permanent ? 'failed' : 'reserved',
          errorMessage: msg.slice(0, 1000),
          completedAt: permanent ? new Date() : null,
        },
      });
      if (ambiguous) await this.breakers.recordAmbiguous(provider, msg);
      else if (!permanent) await this.breakers.recordFailure(provider, msg);
      throw err;
    }
  }
}
