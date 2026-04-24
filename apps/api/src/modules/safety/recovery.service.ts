import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SafetyModeService, SYSTEM_USER_ID } from './safety-mode.service';

/**
 * Pre-flight checks that the operator (or automation) runs BEFORE attempting
 * to exit a protective mode. Each method returns a structured report rather
 * than throwing, so the dashboard can show the operator exactly what is
 * blocking a safe resume.
 */
@Injectable()
export class RecoveryService {
  private readonly log = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly safety: SafetyModeService,
  ) {}

  /** Safe to exit release_restricted? */
  async preflightExitReleaseRestricted() {
    const recentSentAfterAbort = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.action.sent_after_abort',
        occurredAt: { gte: new Date(Date.now() - 10 * 60_000) },
      },
    });
    const recentAmbiguous = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.action.failed',
        occurredAt: { gte: new Date(Date.now() - 10 * 60_000) },
        payloadRedacted: { path: ['ambiguous'], equals: true },
      },
    });
    const openBreakers = await this.prisma.providerCircuitBreaker.count({
      where: { state: { in: ['open', 'half_open'] } },
    });
    const blockers: string[] = [];
    if (recentSentAfterAbort > 0) blockers.push(`sent_after_abort=${recentSentAfterAbort} in last 10m`);
    if (recentAmbiguous > 0) blockers.push(`ambiguous=${recentAmbiguous} in last 10m`);
    if (openBreakers > 0) blockers.push(`open_breakers=${openBreakers}`);
    return { safe: blockers.length === 0, blockers };
  }

  /** Safe to exit audit_compromised? (requires verifying every affected chain) */
  async preflightExitAuditCompromised() {
    const stale = await this.prisma.$queryRawUnsafe<Array<{ scope: string }>>(
      `SELECT ae."chainScope" as scope
         FROM "AuditEvent" ae
         LEFT JOIN "AuditExport" ax ON ax."chainScope" = ae."chainScope"
         GROUP BY ae."chainScope", ax."exportedUpToSeq"
         HAVING MAX(ae."seq") > COALESCE(ax."exportedUpToSeq", 0)`,
    );

    const brokenScopes: string[] = [];
    for (const s of stale) {
      const res = await this.audit.verifyChain(s.scope);
      if (res) brokenScopes.push(`${s.scope}@seq=${res.brokenAtSeq}`);
    }
    const blockers: string[] = [];
    if (stale.length > 0) blockers.push(`unexported_scopes=${stale.length}`);
    if (brokenScopes.length > 0) blockers.push(`chain_breaks=${brokenScopes.join(',')}`);
    return { safe: blockers.length === 0, blockers, unexportedScopes: stale.length, brokenScopes };
  }

  /**
   * Reconciler: idempotently re-asserts every outbox row into BullMQ.
   * Safe to run during recovery because deterministic job IDs make duplicate
   * handoffs no-ops. Does NOT touch terminal release actions.
   */
  async reconcileOutbox(limit = 500) {
    const rows = await this.prisma.outboxEvent.findMany({
      orderBy: { availableAt: 'asc' },
      take: limit,
    });
    // Clear lockedUntil so the relay picks them up immediately.
    await this.prisma.outboxEvent.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { lockedUntil: null },
    });
    await this.audit.record({
      userId: SYSTEM_USER_ID,
      actor: 'admin',
      eventType: 'recovery.outbox.reconciled',
      payload: { count: rows.length },
    });
    return { pokedRows: rows.length };
  }
}
