import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnvelopeService } from './envelope.service';
import { SafetyModeService } from '../safety/safety-mode.service';
import { logger } from '../../observability/logger';

/**
 * THE ONLY sanctioned path for action-payload decryption.
 *
 * Guarantees (each failure throws BEFORE any decrypt attempt):
 *   IL1   process must be 'release-worker' role
 *   Pol.  'vault.decrypt' capability allowed under current safety mode
 *   State release must exist and NOT be canceled
 *   State scenario must be in release_in_progress
 *   State release action must not be in a terminal state
 *
 * The returned plaintext is passed to the caller as a Buffer with a strong
 * recommendation: wrap use in try/finally { plaintext.fill(0); }. The method
 * returns a helper `dispose()` for convenience.
 *
 * Outside a release-worker process this class throws at construction time.
 */
@Injectable()
export class VaultDecryptor implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeService,
    private readonly safety: SafetyModeService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const role = this.config.get<string>('PROCESS_ROLE') ?? 'api';
    if (role !== 'release-worker') {
      throw new Error(
        `VaultDecryptor must only be constructed in release-worker process (current role=${role})`,
      );
    }
    logger.info({ role }, 'vault-decryptor.ready');
  }

  /**
   * Open an action payload for a specific release action. Enforces all
   * invariants atomically against the current DB snapshot; the release
   * worker must still re-check state post-decrypt and pre-send to close
   * the small pre-send race window (that check lives in the worker).
   */
  async openForAction(actionId: string, messageId: string): Promise<{
    plaintext: Buffer;
    channel: 'email' | 'sms' | 'social';
    dispose: () => void;
  }> {
    await this.safety.assert('vault.decrypt');

    const action = await this.prisma.releaseAction.findUnique({
      where: { id: actionId },
      include: { release: { include: { scenario: true } } },
    });
    if (!action) throw new Error(`vault.decrypt: action ${actionId} not found`);
    if (['executed', 'failed_permanent', 'aborted', 'suppressed', 'sent_after_abort'].includes(action.state)) {
      throw new Error(`vault.decrypt: action ${actionId} terminal state=${action.state}`);
    }
    if (action.release.canceledAt) {
      throw new Error(`vault.decrypt: release ${action.releaseId} canceled`);
    }
    if (action.release.scenario.state !== 'release_in_progress') {
      throw new Error(`vault.decrypt: scenario not in release_in_progress (state=${action.release.scenario.state})`);
    }

    const msg = await this.prisma.bundleMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new Error(`vault.decrypt: message ${messageId} not found`);

    const aad = `${msg.bundleId}|${msg.id}|${msg.channel}`;
    const plaintext = await this.envelope.open(
      { ciphertext: msg.messageCiphertext, nonce: msg.messageNonce, wrappedDek: msg.messageDekWrapped },
      aad,
    );
    return {
      plaintext,
      channel: msg.channel,
      dispose: () => plaintext.fill(0),
    };
  }
}
