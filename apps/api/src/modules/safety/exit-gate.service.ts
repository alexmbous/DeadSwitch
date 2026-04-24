import { Injectable } from '@nestjs/common';
import { SafetyModeKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ExitReport {
  targetMode: SafetyModeKind;
  safe: boolean;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
  blockers: string[];
}

/**
 * Machine-checkable "ready to exit" conditions. The Admin service runs this
 * before executing an exit_mode approval; the dashboard surfaces the same
 * report for operators preparing to approve.
 */
@Injectable()
export class ExitGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async evaluate(currentMode: SafetyModeKind, targetMode: SafetyModeKind): Promise<ExitReport> {
    const checks: ExitReport['checks'] = [];

    // Shared checks for returning to normal:
    if (targetMode === 'normal') {
      checks.push(await this.checkAmbiguousSends());
      checks.push(await this.checkOpenBreakers());
      checks.push(await this.checkOutboxLag());
      checks.push(await this.checkSentAfterAbort());

      if (currentMode === 'audit_compromised') {
        checks.push(await this.checkAuditIntegrity());
        checks.push(await this.checkAuditExportLag());
      }
      if (currentMode === 'emergency_freeze') {
        checks.push(await this.checkAuditIntegrity());
        checks.push(await this.checkAuditExportLag());
        checks.push(await this.checkNoInFlightDispatches());
      }
    }

    const blockers = checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`);
    return { targetMode, safe: blockers.length === 0, checks, blockers };
  }

  private async checkAmbiguousSends() {
    const n = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.action.failed',
        occurredAt: { gte: new Date(Date.now() - 10 * 60_000) },
        payloadRedacted: { path: ['ambiguous'], equals: true },
      },
    });
    return { id: 'no_ambiguous_10m', passed: n === 0, detail: `ambiguous=${n}` };
  }

  private async checkSentAfterAbort() {
    const n = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.action.sent_after_abort',
        occurredAt: { gte: new Date(Date.now() - 30 * 60_000) },
      },
    });
    return { id: 'no_sent_after_abort_30m', passed: n === 0, detail: `sent_after_abort=${n}` };
  }

  private async checkOpenBreakers() {
    const n = await this.prisma.providerCircuitBreaker.count({
      where: { state: { in: ['open', 'half_open'] } },
    });
    return { id: 'no_open_breakers', passed: n === 0, detail: `open_or_half=${n}` };
  }

  private async checkOutboxLag() {
    const oldest = await this.prisma.outboxEvent.findFirst({
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    });
    if (!oldest) return { id: 'outbox_lag_ok', passed: true, detail: 'empty' };
    const ageSec = Math.round((Date.now() - oldest.availableAt.getTime()) / 1000);
    return { id: 'outbox_lag_ok', passed: ageSec < 60, detail: `oldest_age_sec=${ageSec}` };
  }

  private async checkAuditIntegrity() {
    // Tamper signal: any scope whose verify fails.
    const scopes: Array<{ scope: string }> = await this.prisma.$queryRawUnsafe(
      `SELECT DISTINCT "chainScope" as scope FROM "AuditEvent" ORDER BY scope`,
    );
    const broken: string[] = [];
    for (const s of scopes) {
      const r = await this.audit.verifyChain(s.scope);
      if (r) broken.push(`${s.scope}@${r.brokenAtSeq}`);
      if (broken.length >= 3) break;
    }
    return { id: 'audit_chain_intact', passed: broken.length === 0, detail: `broken=${broken.join(',') || 'none'}` };
  }

  private async checkAuditExportLag() {
    const rows: Array<{ max: number }> = await this.prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - ax."lastExportedAt"))),0)::int as max FROM "AuditExport" ax`,
    );
    const sec = Number(rows[0]?.max ?? 0);
    return { id: 'audit_export_fresh', passed: sec < 1800, detail: `export_lag_sec=${sec}` };
  }

  private async checkNoInFlightDispatches() {
    const n = await this.prisma.releaseAction.count({
      where: { state: 'sending' },
    });
    return { id: 'no_inflight_dispatches', passed: n === 0, detail: `sending=${n}` };
  }
}
