import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionCacheService } from '../sessions/session-cache.service';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly sessionCache: SessionCacheService,
  ) {}

  async register(email: string, phoneE164: string, displayName: string, password: string, ctx: AuthContext) {
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('email already registered');

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 64 * 1024,
      timeCost: 3,
      parallelism: 1,
    });

    const cooldownSecs = this.config.get<number>('ACCOUNT_COOLDOWN_SECONDS') ?? 259_200;
    const cooldownUntil = new Date(Date.now() + cooldownSecs * 1000);

    const user = await this.prisma.user.create({
      data: { email, phoneE164, displayName, passwordHash, cooldownUntil, kdfVersion: 1 },
    });

    return this.issueSession(user.id, null, ctx);
  }

  async login(email: string, password: string, ctx: AuthContext) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('invalid credentials');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    if (user.status !== 'active') throw new UnauthorizedException('account not active');
    return this.issueSession(user.id, null, ctx);
  }

  async refresh(presentedRefreshToken: string, ctx: AuthContext) {
    const tokenHash = sha256(presentedRefreshToken);
    // Do the entire rotation transactionally so we cannot lose the old
    // session's revocation if the new session insert fails.
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { refreshTokenHash: tokenHash } });
      if (!session) throw new UnauthorizedException('invalid refresh token');

      // --- REUSE DETECTION ---
      if (session.revokedAt) {
        const family = await tx.session.findMany({
          where: { familyId: session.familyId },
          select: { id: true },
        });
        await tx.session.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'family_compromise' },
        });
        // Invalidate caches synchronously so currently-live access tokens
        // from this family are rejected on their next request.
        await this.sessionCache.invalidateFamily(family.map((s) => s.id));
        throw new UnauthorizedException('refresh token reuse detected; session family revoked');
      }
      if (session.expiresAt <= new Date()) {
        throw new UnauthorizedException('refresh token expired');
      }

      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'rotated' },
      });
      const fresh = await this.createSessionRow(tx, session.userId, session.familyId, session.id, ctx);
      return { fresh, oldSessionId: session.id };
    });

    // Invalidate cache for the rotated session *after* the tx commits,
    // so an in-flight request that raced the tx sees the now-authoritative
    // revocation on its next validate().
    await this.sessionCache.invalidate(result.oldSessionId);
    return result.fresh;
  }

  async logout(presentedRefreshToken: string) {
    const tokenHash = sha256(presentedRefreshToken);
    const sessions = await this.prisma.session.findMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      select: { id: true },
    });
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
    await this.sessionCache.invalidateFamily(sessions.map((s) => s.id));
    return { ok: true };
  }

  async revokeAllForUser(userId: string, reason: 'admin_revoke' | 'family_compromise' = 'admin_revoke') {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.sessionCache.invalidateFamily(sessions.map((s) => s.id));
  }

  async verifyPasswordProof(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('password re-verification failed');
  }

  private async issueSession(userId: string, parentFamily: string | null, ctx: AuthContext) {
    const familyId = parentFamily ?? crypto.randomUUID();
    return this.prisma.$transaction((tx) => this.createSessionRow(tx, userId, familyId, null, ctx));
  }

  private async createSessionRow(
    tx: any,
    userId: string,
    familyId: string,
    parentId: string | null,
    ctx: AuthContext,
  ) {
    // Refresh token is an opaque 256-bit random string; we never store it,
    // only its SHA-256 hash.
    const refresh = crypto.randomBytes(32).toString('base64url');
    const refreshTokenHash = sha256(refresh);
    const refreshTtl = this.config.get<number>('JWT_REFRESH_TTL') ?? 2_592_000;

    const session = await tx.session.create({
      data: {
        userId,
        familyId,
        parentId,
        refreshTokenHash,
        deviceId: ctx.deviceId ?? null,
        userAgent: ctx.userAgent?.slice(0, 200) ?? null,
        ipHash: ctx.ip ? sha256(ctx.ip) : null,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    const access = await this.jwt.signAsync({ sub: userId, sid: session.id, fid: familyId });

    return {
      accessToken: access,
      refreshToken: refresh,
      refreshExpiresAt: session.expiresAt.toISOString(),
      sessionId: session.id,
    };
  }
}

export interface AuthContext {
  ip?: string;
  userAgent?: string;
  deviceId?: string;
}
