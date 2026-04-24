import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { KmsService } from '../crypto/kms.service';
import { AuditService } from '../audit/audit.service';
import { SafetyModeService } from '../safety/safety-mode.service';
import { logger } from '../../observability/logger';
import {
  deriveKek,
  parseAttachmentBlob,
  resolvePepper,
  sealDek,
} from './attachment-token-crypto';

export interface IssuedToken {
  attachmentId: string;
  recipientId: string;
  rawToken: string;
  expiresAt: Date;
  displayFilename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Release-worker-only issuer for AttachmentAccessToken.
 *
 * Each call:
 *   1. asserts safety capability `attachment.issue_link`
 *   2. reads the on-disk ciphertext blob
 *   3. KMS-unwraps the per-attachment DEK
 *   4. generates per-token salt + raw token
 *   5. derives KEK = HKDF(rawToken || pepper, salt) and seals the DEK under it
 *   6. zeroizes the plaintext DEK
 *   7. persists tokenIndex + argon2id(tokenHash) + sealedDek + scope columns
 *
 * The plaintext DEK lives only inside this method's stack and is wiped in a
 * `finally` block. The raw token is returned to the caller exactly once for
 * embedding in the recipient's outbound link; it is never persisted.
 */
@Injectable()
export class AttachmentReleaseIssuer implements OnModuleInit {
  private readonly log = new Logger(AttachmentReleaseIssuer.name);
  private readonly blobRoot: string;
  private readonly pepper: Buffer;
  private readonly defaultTtlSeconds: number;
  private readonly defaultMaxUses: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kms: KmsService,
    private readonly audit: AuditService,
    private readonly safety: SafetyModeService,
    private readonly config: ConfigService,
  ) {
    this.blobRoot =
      this.config.get<string>('BLOB_STORAGE_PATH') ??
      path.resolve(process.cwd(), 'data', 'blobs');
    this.pepper = resolvePepper(this.config.get<string>('RECIPIENT_TOKEN_HMAC_KEY'));
    this.defaultTtlSeconds = Number(this.config.get('ATTACHMENT_LINK_TTL_SECONDS') ?? 7 * 24 * 3600);
    this.defaultMaxUses = Number(this.config.get('ATTACHMENT_LINK_MAX_USES') ?? 5);
  }

  onModuleInit() {
    const role = this.config.get<string>('PROCESS_ROLE') ?? 'api';
    if (role !== 'release-worker') {
      throw new Error(
        `AttachmentReleaseIssuer must only be constructed in release-worker process (current role=${role})`,
      );
    }
    logger.info({ role }, 'attachment-issuer.ready');
  }

  /**
   * Issue tokens for every attachment in a bundle, scoped to a single
   * (release, recipient). Returns the raw tokens (one-shot) for the caller
   * to embed in the outbound link block.
   */
  async issueForAction(args: {
    releaseId: string;
    releaseActionId: string;
    bundleId: string;
    recipientId: string;
    userId: string;
    scenarioId: string;
  }): Promise<IssuedToken[]> {
    await this.safety.assert('attachment.issue_link');

    const attachments = await this.prisma.bundleAttachment.findMany({
      where: { bundleId: args.bundleId, encryptionMode: 'action_envelope' },
      orderBy: { createdAt: 'asc' },
    });
    if (attachments.length === 0) return [];

    const issued: IssuedToken[] = [];
    for (const att of attachments) {
      try {
        const tok = await this.issueOne(att, args);
        issued.push(tok);
        await this.audit.record({
          userId: args.userId,
          scenarioId: args.scenarioId,
          actor: 'release_worker',
          eventType: 'attachment.link_issued',
          payload: {
            attachmentId: att.id,
            recipientId: args.recipientId,
            releaseId: args.releaseId,
            releaseActionId: args.releaseActionId,
            expiresAt: tok.expiresAt.toISOString(),
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
          },
        });
      } catch (err) {
        // Audit + rethrow. The caller (executor) treats this as a failed
        // dispatch and lets retry semantics handle it.
        await this.audit.record({
          userId: args.userId,
          scenarioId: args.scenarioId,
          actor: 'release_worker',
          eventType: 'attachment.decrypt_failed',
          payload: {
            attachmentId: att.id,
            recipientId: args.recipientId,
            releaseId: args.releaseId,
            phase: 'issue',
            reason: (err as Error).message.slice(0, 300),
          },
        });
        throw err;
      }
    }
    return issued;
  }

  private async issueOne(
    att: {
      id: string;
      bundleId: string;
      blobRef: string;
      mimeType: string;
      sizeBytes: number;
      displayFilename: string;
    },
    args: {
      releaseId: string;
      releaseActionId: string;
      bundleId: string;
      recipientId: string;
    },
  ): Promise<IssuedToken> {
    const blob = await this.readBlob(att.blobRef);
    const parsed = parseAttachmentBlob(blob);

    let plainDek: Buffer | null = null;
    try {
      plainDek = await this.kms.unwrap(parsed.wrappedDek);

      const rawToken = crypto.randomBytes(32).toString('base64url');
      const tokenIndex = crypto
        .createHmac('sha256', this.pepper)
        .update(rawToken)
        .digest('hex');
      const tokenHash = await argon2.hash(rawToken, { type: argon2.argon2id });

      const kdfSalt = crypto.randomBytes(32);
      const kek = deriveKek(rawToken, kdfSalt, this.pepper);
      try {
        const sealed = sealDek({
          plainDek,
          kek,
          tokenIndex,
          attachmentId: att.id,
        });

        const expiresAt = new Date(Date.now() + this.defaultTtlSeconds * 1000);
        await this.prisma.attachmentAccessToken.create({
          data: {
            attachmentId: att.id,
            recipientId: args.recipientId,
            releaseId: args.releaseId,
            releaseActionId: args.releaseActionId,
            bundleId: args.bundleId,
            tokenIndex,
            tokenHash,
            kdfSalt,
            sealedDek: sealed.ciphertext,
            sealedDekNonce: sealed.nonce,
            maxUses: this.defaultMaxUses,
            expiresAt,
          },
        });

        return {
          attachmentId: att.id,
          recipientId: args.recipientId,
          rawToken,
          expiresAt,
          displayFilename: att.displayFilename,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
        };
      } finally {
        kek.fill(0);
      }
    } finally {
      if (plainDek) plainDek.fill(0);
    }
  }

  private async readBlob(blobRef: string): Promise<Buffer> {
    if (!blobRef.startsWith('local:')) {
      throw new Error(`unsupported blobRef scheme: ${blobRef.split(':')[0]}`);
    }
    const blobName = blobRef.slice('local:'.length);
    const blobPath = path.join(this.blobRoot, blobName);
    return fs.promises.readFile(blobPath);
  }
}
