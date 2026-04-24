import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Caches session validity to avoid a DB hit on every authenticated request.
 *
 * Cache entry shape:
 *   dd:sess:<id> -> {"u":"<userId>","f":"<familyId>","r":<0|1>}  (JSON, short TTL)
 *
 * Revocation semantics:
 *  - On refresh rotation / logout / family compromise, we MUST invalidate the
 *    cache synchronously. The cache is secondary to the DB and never a
 *    source of truth.
 *  - TTL is short (default 60s) so even a dropped invalidation converges
 *    quickly. Prefer failing-closed: JwtStrategy re-queries the DB on any
 *    cache miss OR when the cached value says r=1.
 *
 * Safety:
 *  - Never cache "valid forever". Revocation must beat TTL worst-case.
 *  - Include familyId in the cache so a buggy consumer cannot attribute a
 *    session to the wrong family.
 */
@Injectable()
export class SessionCacheService implements OnModuleInit, OnModuleDestroy {
  private redis!: Redis;
  private readonly ttl: number;

  constructor(private readonly config: ConfigService) {
    this.ttl = Number(config.get('SESSION_CACHE_TTL_SECONDS') ?? 60);
  }

  onModuleInit() {
    this.redis = new Redis(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  private key(sessionId: string): string {
    return `dd:sess:${sessionId}`;
  }

  async peek(sessionId: string): Promise<null | { userId: string; familyId: string; revoked: boolean }> {
    const raw = await this.redis.get(this.key(sessionId));
    if (!raw) return null;
    try {
      const { u, f, r } = JSON.parse(raw);
      return { userId: u, familyId: f, revoked: r === 1 };
    } catch {
      return null;
    }
  }

  async putValid(sessionId: string, userId: string, familyId: string) {
    await this.redis.set(
      this.key(sessionId),
      JSON.stringify({ u: userId, f: familyId, r: 0 }),
      'EX',
      this.ttl,
    );
  }

  /** Called on revoke/rotate/logout. Leaves a short-lived `revoked` tombstone
   *  so that a fresh lookup within the TTL window does not silently re-fetch
   *  a now-stale `valid` entry from a racing writer. */
  async invalidate(sessionId: string) {
    await this.redis.set(
      this.key(sessionId),
      JSON.stringify({ u: '', f: '', r: 1 }),
      'EX',
      Math.max(this.ttl, 30),
    );
  }

  /** Invalidate every session in a family (used on reuse detection). */
  async invalidateFamily(sessionIds: string[]) {
    if (sessionIds.length === 0) return;
    const pipe = this.redis.pipeline();
    for (const id of sessionIds) {
      pipe.set(this.key(id), JSON.stringify({ u: '', f: '', r: 1 }), 'EX', Math.max(this.ttl, 30));
    }
    await pipe.exec();
  }
}
