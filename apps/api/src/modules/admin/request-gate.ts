import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyModeService } from '../safety/safety-mode.service';

/**
 * Computes the "approver-sees" state hash. An approval is only valid if the
 * same hash is recomputed at approve time. The fields chosen are those that
 * materially affect whether a given admin action is safe.
 */
@Injectable()
export class RequestGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyModeService,
  ) {}

  async snapshot(): Promise<{ hash: string; body: string }> {
    const mode = await this.safety.current();
    const [
      openBreakers,
      pendingActions,
      ambiguous5m,
      sentAfterAbort10m,
      auditLag,
    ] = await Promise.all([
      this.prisma.providerCircuitBreaker.findMany({
        where: { state: { in: ['open', 'half_open'] } },
        select: { provider: true, state: true },
        orderBy: { provider: 'asc' },
      }),
      this.prisma.releaseAction.count({ where: { state: 'sending' } }),
      this.prisma.auditEvent.count({
        where: {
          eventType: 'release.action.failed',
          occurredAt: { gte: new Date(Date.now() - 5 * 60_000) },
          payloadRedacted: { path: ['ambiguous'], equals: true },
        },
      }),
      this.prisma.auditEvent.count({
        where: {
          eventType: 'release.action.sent_after_abort',
          occurredAt: { gte: new Date(Date.now() - 10 * 60_000) },
        },
      }),
      this.prisma.$queryRawUnsafe<Array<{ lag: number }>>(
        `SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - ax."lastExportedAt"))), 0)::int as lag
           FROM "AuditExport" ax`,
      ),
    ]);

    const canonical = JSON.stringify({
      mode: mode.mode,
      isolated: [...mode.isolatedProviders].sort(),
      breakers: openBreakers,
      pendingActions,
      ambiguous5m,
      sentAfterAbort10m,
      auditLagSec: Number(auditLag[0]?.lag ?? 0),
    });
    const hash = crypto.createHash('sha256').update(canonical).digest('hex');
    return { hash, body: canonical };
  }
}
