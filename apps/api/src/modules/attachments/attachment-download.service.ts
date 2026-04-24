import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SafetyModeService } from '../safety/safety-mode.service';
import {
  deriveKek,
  openDek,
  parseAttachmentBlob,
  resolvePepper,
  sha256Hex,
  timingSafeHexEqual,
} from './attachment-token-crypto';
import { buildAttachmentAad } from './attachment-mime';

export interface DownloadResult {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

/**
 * Recipient-facing decrypt boundary for BundleAttachment payloads.
 *
 * NOTE on the role split:
 *   Action payloads (BundleMessage) are decrypted only by the release
 *   worker via VaultDecryptor — that path requires KmsService.unwrap, which
 *   the API role cannot call. Attachments take a different shape: at
 *   release-time the worker re-wraps the per-attachment DEK under a key
 *   derived from the recipient's one-time link token. This service unwraps
 *   that DEK using ONLY the presented raw token + per-token salt + server
 *   pepper. KMS is never invoked here. Therefore the API can decrypt an
 *   attachment iff the recipient presents the raw token (out-of-band) AND
 *   the row is still alive (uses < max, not expired, not revoked, scope
 *   matches). KMS-decrypt capability remains release-worker-only.
 */
@Injectable()
export class AttachmentDownloadService {
  private readonly log = new Logger(AttachmentDownloadService.name);
  private readonly blobRoot: string;
  private readonly pepper: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly safety: SafetyModeService,
    private readonly config: ConfigService,
  ) {
    this.blobRoot =
      this.config.get<string>('BLOB_STORAGE_PATH') ??
      path.resolve(process.cwd(), 'data', 'blobs');
    this.pepper = resolvePepper(this.config.get<string>('RECIPIENT_TOKEN_HMAC_KEY'));
  }

  async download(rawToken: string, attachmentId: string): Promise<DownloadResult> {
    await this.safety.assert('attachment.access');

    const tokenIndex = crypto
      .createHmac('sha256', this.pepper)
      .update(rawToken)
      .digest('hex');

    const row = await this.prisma.attachmentAccessToken.findUnique({
      where: { tokenIndex },
      include: {
        attachment: { include: { bundle: { include: { scenario: true } } } },
      },
    });

    // No row → no userId → no chained audit. Fail closed; throttler bounds
    // enumeration. (Audit needs a real userId for FK; we don't fabricate one.)
    if (!row) throw new NotFoundException('token not found');

    const userId = row.attachment.bundle.scenario.userId;
    const scenarioId = row.attachment.bundle.scenario.id;

    await this.audit.record({
      userId, scenarioId,
      actor: 'system',
      eventType: 'attachment.access_attempt',
      payload: { attachmentId, tokenId: row.id },
    });

    // Constant-time-ish argon2 verify — gate any further branching on it.
    const argonOk = await argon2.verify(row.tokenHash, rawToken).catch(() => false);
    if (!argonOk) {
      await this.recordDenied(userId, scenarioId ?? undefined, attachmentId, 'token_hash_mismatch');
      throw new NotFoundException('token not found');
    }

    if (row.attachmentId !== attachmentId) {
      await this.recordDenied(userId, scenarioId ?? undefined, attachmentId, 'scope_mismatch');
      throw new ForbiddenException('token not valid for this attachment');
    }
    if (row.revokedAt) {
      await this.recordDenied(userId, scenarioId ?? undefined, attachmentId, 'revoked');
      throw new GoneException('token revoked');
    }
    if (row.expiresAt <= new Date()) {
      await this.audit.record({
        userId, scenarioId,
        actor: 'system',
        eventType: 'attachment.expired',
        payload: { attachmentId, tokenId: row.id },
      });
      throw new GoneException('token expired');
    }
    if (row.uses >= row.maxUses) {
      await this.recordDenied(userId, scenarioId ?? undefined, attachmentId, 'max_uses_exceeded');
      throw new GoneException('token usage exhausted');
    }

    // Atomically claim a use. If the CAS-style updateMany doesn't claim a
    // row we lost the race; treat as exhausted.
    const claimed = await this.prisma.attachmentAccessToken.updateMany({
      where: {
        id: row.id,
        uses: { lt: row.maxUses },
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        uses: { increment: 1 },
        firstUsedAt: row.firstUsedAt ?? new Date(),
        lastUsedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      await this.recordDenied(userId, scenarioId ?? undefined, attachmentId, 'race_lost');
      throw new GoneException('token no longer usable');
    }

    // Read blob and verify hash BEFORE attempting decrypt.
    const att = row.attachment;
    let blob: Buffer;
    try {
      blob = await this.readBlob(att.blobRef);
    } catch (err) {
      await this.audit.record({
        userId, scenarioId,
        actor: 'system',
        eventType: 'attachment.decrypt_failed',
        payload: { attachmentId, tokenId: row.id, phase: 'blob_read', reason: (err as Error).message.slice(0, 200) },
      });
      throw new GoneException('attachment unavailable');
    }

    let parsed;
    try {
      parsed = parseAttachmentBlob(blob);
    } catch (err) {
      await this.audit.record({
        userId, scenarioId,
        actor: 'system',
        eventType: 'attachment.decrypt_failed',
        payload: { attachmentId, tokenId: row.id, phase: 'parse', reason: (err as Error).message.slice(0, 200) },
      });
      throw new GoneException('attachment corrupt');
    }

    const observedHash = sha256Hex(parsed.ciphertext);
    if (!timingSafeHexEqual(observedHash, att.ciphertextHash)) {
      // High-severity: blob has been tampered with or corrupted on disk.
      await this.audit.record({
        userId, scenarioId,
        actor: 'system',
        eventType: 'attachment.hash_mismatch',
        payload: {
          attachmentId,
          tokenId: row.id,
          expectedHashPrefix: att.ciphertextHash.slice(0, 16),
          observedHashPrefix: observedHash.slice(0, 16),
          severity: 'high',
        },
      });
      throw new GoneException('attachment integrity check failed');
    }

    // Decrypt sealed DEK and then the ciphertext.
    let plainDek: Buffer | null = null;
    let plaintext: Buffer;
    try {
      const kek = deriveKek(rawToken, row.kdfSalt, this.pepper);
      try {
        plainDek = openDek({
          sealed: row.sealedDek,
          nonce: row.sealedDekNonce,
          kek,
          tokenIndex,
          attachmentId,
        });
      } finally {
        kek.fill(0);
      }

      plaintext = this.decryptCiphertext({
        ciphertext: parsed.ciphertext,
        nonce: parsed.nonce,
        dek: plainDek,
        att,
      });
    } catch (err) {
      await this.audit.record({
        userId, scenarioId,
        actor: 'system',
        eventType: 'attachment.decrypt_failed',
        payload: { attachmentId, tokenId: row.id, phase: 'decrypt', reason: (err as Error).message.slice(0, 200) },
      });
      throw new GoneException('decryption failed');
    } finally {
      if (plainDek) plainDek.fill(0);
    }

    await this.audit.record({
      userId, scenarioId,
      actor: 'system',
      eventType: 'attachment.downloaded',
      payload: {
        attachmentId,
        tokenId: row.id,
        sizeBytes: att.sizeBytes,
        usesAfter: row.uses + 1,
        maxUses: row.maxUses,
      },
    });

    return {
      filename: att.displayFilename,
      mimeType: att.mimeType,
      bytes: plaintext,
    };
  }

  private decryptCiphertext(args: {
    ciphertext: Buffer;
    nonce: Buffer;
    dek: Buffer;
    att: {
      bundleId: string;
      id: string;
      mimeType: string;
      displayFilename: string;
      aadVersion: number;
    };
  }): Buffer {
    const aad = buildAttachmentAad({
      aadVersion: args.att.aadVersion,
      bundleId: args.att.bundleId,
      attachmentId: args.att.id,
      mimeType: args.att.mimeType,
      displayFilename: args.att.displayFilename,
    });
    const tag = args.ciphertext.subarray(args.ciphertext.length - 16);
    const body = args.ciphertext.subarray(0, args.ciphertext.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', args.dek, args.nonce);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }

  private async readBlob(blobRef: string): Promise<Buffer> {
    if (!blobRef.startsWith('local:')) {
      throw new Error(`unsupported blobRef scheme: ${blobRef.split(':')[0]}`);
    }
    const blobName = blobRef.slice('local:'.length);
    const blobPath = path.join(this.blobRoot, blobName);
    return fs.promises.readFile(blobPath);
  }

  private async recordDenied(
    userId: string,
    scenarioId: string | undefined,
    attachmentId: string,
    reason: string,
  ) {
    await this.audit.record({
      userId,
      scenarioId,
      actor: 'system',
      eventType: 'attachment.access_denied',
      payload: { attachmentId, reason },
    });
  }
}
