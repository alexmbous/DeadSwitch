import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProviderAdapter, SecureLink } from '../providers/provider-adapter';
import {
  AmbiguousOutcome,
  ClientError,
  ProviderError,
} from '../providers/error-classifier';
import { StateMachineService } from '../state/state.service';
import {
  SafetyBlockedError,
  SafetyModeService,
} from '../safety/safety-mode.service';
import { VaultDecryptor } from '../crypto/vault-decryptor';
import { AttachmentReleaseIssuer, IssuedToken } from '../attachments/attachment-release-issuer.service';

const MAX_ATTEMPTS = 5;

/**
 * Runs a single release action through the chokepoints. The release worker
 * binary and the integration test suite both call this service; there is no
 * test-only code path.
 */
@Injectable()
export class ReleaseActionExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly adapter: ProviderAdapter,
    private readonly sm: StateMachineService,
    private readonly safety: SafetyModeService,
    private readonly vault: VaultDecryptor,
    private readonly attachments: AttachmentReleaseIssuer,
    private readonly config: ConfigService,
  ) {}

  private linkUrlFor(token: string, attachmentId: string): string {
    const base = this.config.get<string>('PUBLIC_BASE_URL') ?? 'https://deadswitch.local';
    return `${base.replace(/\/$/, '')}/r/${token}/attachments/${attachmentId}`;
  }

  async run(actionId: string, attemptNumber: number): Promise<void> {
    // Global interlock.
    try {
      await this.safety.assert('release.continue_batch');
    } catch (e) {
      if (e instanceof SafetyBlockedError) throw new Error(`safety:${e.capability}`);
      throw e;
    }

    // Sibling-taint check (IL6).
    const loaded = await this.prisma.releaseAction.findUnique({
      where: { id: actionId }, select: { releaseId: true },
    });
    if (loaded) {
      const tainted = await this.prisma.releaseAction.count({
        where: { releaseId: loaded.releaseId, state: 'sent_after_abort' },
      });
      if (tainted > 0) {
        await this.prisma.releaseAction.updateMany({
          where: { id: actionId, state: { in: ['pending', 'failed_temporary'] } },
          data: { state: 'aborted', lastError: 'IL6: sibling sent_after_abort' },
        });
        return;
      }
    }

    const claim = await this.claim(actionId);
    if (!claim || claim.aborted) return;
    const { action, release, scenario } = claim;

    if (!action.messageId) {
      await this.markSuppressed(action.id, scenario.userId, scenario.id, 'no message bound');
      return;
    }
    const recipient = await this.prisma.bundleRecipient.findUnique({ where: { id: action.recipientId } });
    if (!recipient) {
      await this.markSuppressed(action.id, scenario.userId, scenario.id, 'recipient missing');
      return;
    }

    await this.audit.record({
      userId: scenario.userId,
      scenarioId: scenario.id,
      actor: 'release_worker',
      eventType: 'release.action.decrypt',
      payload: { actionId, messageId: action.messageId, attempt: attemptNumber },
    });

    let opened: Awaited<ReturnType<VaultDecryptor['openForAction']>> | null = null;
    try {
      try {
        opened = await this.vault.openForAction(action.id, action.messageId);
      } catch (e) {
        await this.prisma.releaseAction.updateMany({
          where: { id: action.id, state: 'sending' },
          data: { state: 'aborted', lastError: `decrypt_blocked: ${(e as Error).message.slice(0, 300)}` },
        });
        return;
      }

      if (!channelMatchesRecipient(opened.channel, recipient.recipientKind)) {
        await this.markSuppressed(action.id, scenario.userId, scenario.id, 'channel/recipient mismatch');
        return;
      }

      const user = await this.prisma.user.findUnique({ where: { id: scenario.userId } });
      const fromLabel = `DeadSwitch on behalf of ${user?.displayName ?? 'user'}`;
      const body = `${fromLabel}:\n\n${opened.plaintext.toString('utf8')}`;
      const idempotencyKey = `release_action:${action.id}:${attemptNumber}`;
      const channel = opened.channel === 'email' ? 'email' : opened.channel === 'sms' ? 'sms' : 'voice';

      // Issue per-recipient secure links for any attachments in the bundle.
      // If issuance throws (KMS unavailable, blob missing, hash drift) we let
      // it bubble — the action transitions to failed_temporary/permanent the
      // same way a provider error would.
      let issued: IssuedToken[] = [];
      try {
        issued = await this.attachments.issueForAction({
          releaseId: release.id,
          releaseActionId: action.id,
          bundleId: action.bundleId,
          recipientId: recipient.id,
          userId: scenario.userId,
          scenarioId: scenario.id,
        });
      } catch (issueErr) {
        await this.prisma.releaseAction.updateMany({
          where: { id: action.id, state: 'sending' },
          data: {
            state: 'failed_temporary',
            lastError: `attachment_issue: ${(issueErr as Error).message.slice(0, 300)}`,
          },
        });
        throw issueErr;
      }

      const secureLinks: SecureLink[] = issued.map((tok) => ({
        url: this.linkUrlFor(tok.rawToken, tok.attachmentId),
        filename: tok.displayFilename,
        mimeType: tok.mimeType,
        sizeBytes: tok.sizeBytes,
        expiresAt: tok.expiresAt,
      }));

      try {
        const result = await this.adapter.send({
          idempotencyKey,
          releaseActionId: action.id,
          channel,
          to: recipient.address,
          subject: channel === 'email' ? 'A message has been released to you' : undefined,
          body,
          secureLinks: secureLinks.length > 0 ? secureLinks : undefined,
        });

        await this.prisma.$transaction(async (tx) => {
          const current = await tx.release.findUnique({
            where: { id: release.id }, include: { scenario: true },
          });
          const raceLost = !!current?.canceledAt || current?.scenario.state !== 'release_in_progress';
          await tx.releaseAction.updateMany({
            where: { id: action.id, state: 'sending' },
            data: {
              state: raceLost ? 'sent_after_abort' : 'executed',
              provider: result.provider,
              providerMessageId: result.providerMessageId,
              executedAt: new Date(),
            },
          });
          await this.audit.record({
            userId: scenario.userId,
            scenarioId: scenario.id,
            actor: 'release_worker',
            eventType: raceLost ? 'release.action.sent_after_abort' : 'release.action.executed',
            payload: {
              actionId: action.id,
              recipientKind: recipient.recipientKind,
              provider: result.provider,
              reused: result.reused,
              providerMessageId: result.providerMessageId,
            },
          });
        });
      } catch (err) {
        const classified = err instanceof ProviderError ? err : null;
        const ambiguous = classified instanceof AmbiguousOutcome;
        const permanent = classified instanceof ClientError;
        const reachedMax = attemptNumber >= MAX_ATTEMPTS;
        const nextState = ambiguous
          ? 'failed_temporary'
          : permanent || reachedMax
          ? 'failed_permanent'
          : 'failed_temporary';

        await this.prisma.releaseAction.updateMany({
          where: { id: action.id, state: 'sending' },
          data: {
            state: nextState,
            lastError: (ambiguous ? 'ambiguous: ' : '') + (err as Error).message.slice(0, 500),
          },
        });
        await this.audit.record({
          userId: scenario.userId,
          scenarioId: scenario.id,
          actor: 'release_worker',
          eventType: 'release.action.failed',
          payload: {
            actionId: action.id,
            kind: classified?.kind ?? 'unknown',
            permanent: permanent || reachedMax,
            ambiguous,
            attempt: attemptNumber,
          },
        });
        if (!ambiguous) throw err;
      }
    } finally {
      opened?.dispose();
    }

    await this.maybeCompleteRelease(release.id, scenario.userId, scenario.id);
  }

  private async claim(actionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const action = await tx.releaseAction.findUnique({
        where: { id: actionId },
        include: { release: { include: { scenario: true } } },
      });
      if (!action) return null;
      if (['executed', 'failed_permanent', 'aborted', 'suppressed', 'sent_after_abort'].includes(action.state)) return null;
      const release = action.release;
      const scenario = release.scenario;
      if (release.canceledAt || scenario.state !== 'release_in_progress') {
        await tx.releaseAction.updateMany({
          where: { id: actionId, state: { in: ['pending', 'sending', 'failed_temporary'] } },
          data: { state: 'aborted', lastError: 'release aborted before send' },
        });
        return { aborted: true as const };
      }
      const claimed = await tx.releaseAction.updateMany({
        where: { id: actionId, state: { in: ['pending', 'failed_temporary'] } },
        data: { state: 'sending', attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      const fresh = await tx.releaseAction.findUnique({ where: { id: actionId } });
      return { aborted: false as const, action: fresh!, release, scenario };
    });
  }

  private async markSuppressed(actionId: string, userId: string, scenarioId: string, reason: string) {
    await this.prisma.releaseAction.updateMany({
      where: { id: actionId, state: 'sending' },
      data: { state: 'suppressed', lastError: reason },
    });
    await this.audit.record({
      userId, scenarioId,
      actor: 'release_worker',
      eventType: 'release.action.suppressed',
      payload: { actionId, reason },
    });
  }

  private async maybeCompleteRelease(releaseId: string, userId: string, scenarioId: string) {
    const pending = await this.prisma.releaseAction.count({
      where: { releaseId, state: { in: ['pending', 'sending', 'failed_temporary'] } },
    });
    if (pending > 0) return;
    const nonExec = await this.prisma.releaseAction.count({
      where: { releaseId, state: { in: ['failed_permanent', 'aborted', 'suppressed', 'sent_after_abort'] } },
    });
    const releaseState = nonExec > 0 ? 'partially_failed' : 'completed';
    await this.prisma.$transaction(async (tx) => {
      await tx.release.update({
        where: { id: releaseId },
        data: { state: releaseState, completedAt: new Date() },
      });
      await this.sm
        .transition(tx, scenarioId, 'complete_release', { releasedAt: new Date() })
        .catch((e) => {
          if (!/state transition .* denied/.test(e.message)) throw e;
        });
    });
    await this.audit.record({
      userId, scenarioId,
      actor: 'release_worker',
      eventType: releaseState === 'completed' ? 'release.completed' : 'release.partially_failed',
      payload: { releaseId },
    });
  }
}

function channelMatchesRecipient(channel: string, recipientKind: string): boolean {
  if (channel === 'email') return recipientKind === 'email';
  if (channel === 'sms') return recipientKind === 'sms';
  return false;
}
