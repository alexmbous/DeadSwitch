import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditActor, Prisma } from '@prisma/client';
import { canonicalize } from './canonical-json';

const GENESIS = '0'.repeat(64);

function chainScopeFor(evt: { scenarioId?: string | null; userId: string }): string {
  return evt.scenarioId ? `scenario:${evt.scenarioId}` : `user:${evt.userId}`;
}

/**
 * Hash-chained audit log with the following integrity properties:
 *
 *  - SCOPE: each chain is one of `scenario:<id>` or `user:<id>`. A break in
 *    any chain is locally detectable (verify_chain fn) without re-hashing
 *    the entire tenant.
 *  - APPEND-ONLY: schema/role permissions must forbid UPDATE and DELETE on
 *    audit_events for the application role. A tampered row still shows as
 *    a hash mismatch when verified.
 *  - CONCURRENT WRITES: a Postgres advisory transaction lock keyed on the
 *    64-bit hash of the scope forces serialization within a scope, so seq
 *    numbers and prevHash references are consistent. Unique(chainScope,seq)
 *    is the second line of defence.
 *  - CANONICAL HASH INPUT: see canonical-json.ts. Same input ⇒ same hash on
 *    any Node version / OS.
 *
 * Limitations we DO NOT claim to solve:
 *  - An attacker with DB superuser can still rewrite history. Ship audit
 *    events to an external WORM store (e.g. S3 Object Lock) out of band to
 *    detect this.
 *  - Clock skew: occurredAt is advisory, not authoritative; seq is the
 *    authoritative ordering within a scope.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(evt: {
    userId: string;
    scenarioId?: string;
    actor: AuditActor;
    eventType: string;
    payload: Record<string, unknown>;
  }) {
    const scope = chainScopeFor(evt);
    const lockKey = crypto.createHash('sha256').update(scope).digest();
    // Postgres advisory lock wants two int4 or one int8. Use first 8 bytes.
    const lockInt = lockKey.readBigInt64BE(0);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockInt}::bigint)`;

      const last = await tx.auditEvent.findFirst({
        where: { chainScope: scope },
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      });
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? GENESIS;

      const hashInput = canonicalize({
        chainScope: scope,
        seq,
        userId: evt.userId,
        scenarioId: evt.scenarioId ?? null,
        actor: evt.actor,
        eventType: evt.eventType,
        payload: evt.payload,
        prevHash,
      });
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

      return tx.auditEvent.create({
        data: {
          userId: evt.userId,
          scenarioId: evt.scenarioId,
          chainScope: scope,
          seq,
          actor: evt.actor,
          eventType: evt.eventType,
          payloadRedacted: evt.payload as Prisma.InputJsonValue,
          prevHash,
          hash,
        },
      });
    });
  }

  /** Verifies a single chain. Returns the seq at which the chain breaks, or null if intact. */
  async verifyChain(scope: string): Promise<null | { brokenAtSeq: number }> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { chainScope: scope },
      orderBy: { seq: 'asc' },
    });
    let prev = GENESIS;
    for (const r of rows) {
      const expected = canonicalize({
        chainScope: r.chainScope,
        seq: r.seq,
        userId: r.userId,
        scenarioId: r.scenarioId ?? null,
        actor: r.actor,
        eventType: r.eventType,
        payload: r.payloadRedacted,
        prevHash: prev,
      });
      const h = crypto.createHash('sha256').update(expected).digest('hex');
      if (h !== r.hash || r.prevHash !== prev) return { brokenAtSeq: r.seq };
      prev = r.hash;
    }
    return null;
  }
}
