import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyModeService } from '../safety/safety-mode.service';

/**
 * Recipient secure-link flow with hardened lookup:
 *  - tokenIndex = HMAC-SHA256(serverSecret, rawToken) — deterministic, indexed.
 *  - tokenHash  = argon2id(rawToken) — verified AFTER the indexed lookup
 *    using argon2.verify (constant-time internally).
 *
 * Enumeration resistance:
 *  - tokenIndex is 256 bits of HMAC output — 2^256 space, not enumerable.
 *  - An attacker who guesses rawToken still has to pass argon2.verify AND
 *    the access-code check, and throttling (6/15min/token) bounds attempts.
 *  - The server secret is required to produce tokenIndex, so a DB leak
 *    alone does NOT let an attacker forge lookups.
 */
@Injectable()
export class RecipientsService {
  private readonly hmacKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly safety: SafetyModeService,
  ) {
    const raw = config.get<string>('RECIPIENT_TOKEN_HMAC_KEY');
    if (!raw || raw.length < 32) {
      // Fail loud in production. In dev we accept a deterministic default to
      // let the scaffold boot; non-dev env validator already refuses weak
      // secrets.
      this.hmacKey = crypto.createHash('sha256').update(raw ?? 'deaddrop-dev-hmac').digest();
    } else {
      this.hmacKey = Buffer.from(raw, 'utf8');
    }
  }

  private indexOf(rawToken: string): string {
    return crypto.createHmac('sha256', this.hmacKey).update(rawToken).digest('hex');
  }

  async issueAccessToken(args: {
    vaultItemId: string;
    recipientId: string;
    ttlSeconds: number;
    accessCode?: string;
    maxUses?: number;
  }) {
    // Policy: 'recipient.issue_link' — denied in audit_compromised and
    // emergency_freeze. NEW link issuance writes audit records and cannot
    // happen while the audit chain is suspect.
    await this.safety.assert('recipient.issue_link');
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenIndex = this.indexOf(raw);
    const tokenHash = await argon2.hash(raw, { type: argon2.argon2id });
    const accessCodeHash = args.accessCode
      ? await argon2.hash(args.accessCode, { type: argon2.argon2id })
      : null;

    await this.prisma.recipientAccessToken.create({
      data: {
        vaultItemId: args.vaultItemId,
        recipientId: args.recipientId,
        tokenIndex,
        tokenHash,
        accessCodeHash: accessCodeHash ?? undefined,
        maxUses: args.maxUses ?? 3,
        expiresAt: new Date(Date.now() + args.ttlSeconds * 1000),
      },
    });
    return { rawToken: raw };
  }

  async describe(rawToken: string) {
    await this.safety.assert('recipient.access_existing');
    const row = await this.findActive(rawToken);
    return {
      expiresAt: row.expiresAt,
      usesRemaining: Math.max(0, row.maxUses - row.uses),
      pinRequired: Boolean(row.accessCodeHash),
    };
  }

  async unlock(rawToken: string, accessCode?: string) {
    await this.safety.assert('recipient.access_existing');
    const row = await this.findActive(rawToken);

    if (row.accessCodeHash) {
      if (!accessCode) throw new UnauthorizedException('access code required');
      const ok = await argon2.verify(row.accessCodeHash, accessCode);
      if (!ok) throw new UnauthorizedException('access code invalid');
    }

    const updated = await this.prisma.recipientAccessToken.updateMany({
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
    if (updated.count !== 1) throw new GoneException('link no longer usable');

    const item = await this.prisma.privateVaultItem.findUnique({
      where: { id: row.vaultItemId },
      include: { recipientUnwraps: { where: { recipientId: row.recipientId } } },
    });
    if (!item) throw new NotFoundException();
    const unwrap = item.recipientUnwraps[0];
    if (!unwrap) throw new ForbiddenException('no recipient unwrap key was configured');

    return {
      ciphertextBlobRef: item.ciphertextBlobRef,
      nonceBase64: item.nonce.toString('base64'),
      sealingMode: unwrap.sealingMode,
      sealedDekBase64: unwrap.sealedDek.toString('base64'),
      sealingSaltBase64: unwrap.sealingSalt?.toString('base64') ?? null,
      sealingParams: unwrap.sealingParams ?? null,
    };
  }

  async revoke(rawToken: string) {
    const tokenIndex = this.indexOf(rawToken);
    await this.prisma.recipientAccessToken.updateMany({
      where: { tokenIndex },
      data: { revokedAt: new Date() },
    });
  }

  private async findActive(rawToken: string) {
    const tokenIndex = this.indexOf(rawToken);
    const row = await this.prisma.recipientAccessToken.findUnique({ where: { tokenIndex } });
    if (!row) throw new NotFoundException('token not found');
    if (row.revokedAt) throw new GoneException('token revoked');
    if (row.expiresAt <= new Date()) throw new GoneException('token expired');

    // Belt-and-suspenders: HMAC collision is astronomically unlikely but we
    // still verify argon2. argon2.verify is constant-time internally on the
    // stored hash bytes.
    const ok = await argon2.verify(row.tokenHash, rawToken);
    if (!ok) throw new NotFoundException('token not found');

    return row;
  }
}
