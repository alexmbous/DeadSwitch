import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SessionCacheService } from '../sessions/session-cache.service';

export interface JwtPayload {
  sub: string;
  sid: string;
  fid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cache: SessionCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload) {
    // Fast path: cache hit with r=0. Also verify payload matches to prevent
    // a malicious JWT that claims the wrong session id from being accepted
    // on a cache hit (defence in depth — the JWT is already signed).
    const cached = await this.cache.peek(payload.sid);
    if (cached) {
      if (cached.revoked) throw new UnauthorizedException('session revoked');
      if (cached.userId !== payload.sub || cached.familyId !== payload.fid) {
        throw new UnauthorizedException('session/token mismatch');
      }
      return { userId: payload.sub, sessionId: payload.sid, familyId: payload.fid };
    }

    // Miss: hit the DB and warm the cache.
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, userId: true, familyId: true },
    });
    if (!session || session.revokedAt || session.userId !== payload.sub || session.familyId !== payload.fid) {
      // Negative cache: prevents repeated DB lookups for a deleted/revoked id.
      await this.cache.invalidate(payload.sid);
      throw new UnauthorizedException('session revoked');
    }
    await this.cache.putValid(payload.sid, session.userId, session.familyId);
    return { userId: payload.sub, sessionId: payload.sid, familyId: payload.fid };
  }
}
