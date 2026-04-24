import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyModeService } from '../safety/safety-mode.service';
import { ExitGateService } from '../safety/exit-gate.service';
import { POLICY } from '../safety/policy-version';

/**
 * Read-only aggregator for the operator dashboard. Every field has a
 * stable shape and RAG classification so the UI can render deterministic
 * status pills without extra logic.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyModeService,
    private readonly exitGate: ExitGateService,
  ) {}

  async overview() {
    const mode = await this.safety.current();
    const breakers = await this.prisma.providerCircuitBreaker.findMany({});
    const activeReleases = await this.prisma.release.count({ where: { state: 'executing' } });
    const queuedReleaseOutbox = await this.prisma.outboxEvent.count({ where: { queueName: 'release' } });
    const oldestOutbox = await this.prisma.outboxEvent.findFirst({
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    });

    const ambiguous5m = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.action.failed',
        occurredAt: { gte: new Date(Date.now() - 5 * 60_000) },
        payloadRedacted: { path: ['ambiguous'], equals: true },
      },
    });

    const sentAfterAbort24h = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.action.sent_after_abort',
        occurredAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      },
    });

    const exportLag = await this.prisma.$queryRawUnsafe<Array<{ max_lag_sec: number }>>(
      `SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - COALESCE(ax."lastExportedAt", NOW() - INTERVAL '100 years')))), 0)::int as max_lag_sec
         FROM "AuditEvent" ae
         LEFT JOIN "AuditExport" ax ON ax."chainScope" = ae."chainScope"
         WHERE ae."seq" > COALESCE(ax."exportedUpToSeq", 0)`,
    );
    const auditExportLagSec = Number(exportLag[0]?.max_lag_sec ?? 0);

    const kmsBreaker = breakers.find((b) => b.provider === 'kms-decrypt');

    // Exit readiness for the current mode (always evaluating targetMode='normal').
    const exitReport =
      mode.mode === 'normal' ? null : await this.exitGate.evaluate(mode.mode, 'normal');

    return {
      policyVersion: POLICY.version,
      exitReport,
      mode: {
        mode: mode.mode,
        isolatedProviders: mode.isolatedProviders,
        enteredAt: mode.enteredAt,
        autoEntered: mode.autoEntered,
        reason: mode.reason,
        rag: ragForMode(mode.mode, mode.autoEntered),
      },
      breakers: breakers.map((b) => ({
        provider: b.provider,
        state: b.state,
        openedAt: b.openedAt,
        nextProbeAt: b.nextProbeAt,
        reason: b.reason,
        rag:
          b.state === 'closed' ? 'green' : b.state === 'half_open' ? 'yellow' : 'red',
      })),
      pausedProviders: {
        count: mode.isolatedProviders.length,
        list: mode.isolatedProviders,
        rag: mode.isolatedProviders.length === 0 ? 'green' : mode.isolatedProviders.length === 1 ? 'yellow' : 'red',
      },
      activeReleases,
      queuedReleaseOutbox: {
        count: queuedReleaseOutbox,
        rag: queuedReleaseOutbox < 10 ? 'green' : queuedReleaseOutbox <= 100 ? 'yellow' : 'red',
      },
      outboxLagSec: oldestOutbox
        ? Math.max(0, Math.round((Date.now() - oldestOutbox.availableAt.getTime()) / 1000))
        : 0,
      ambiguousSends5m: {
        count: ambiguous5m,
        rag: ambiguous5m === 0 ? 'green' : ambiguous5m < 5 ? 'yellow' : 'red',
      },
      sentAfterAbort24h: {
        count: sentAfterAbort24h,
        rag: sentAfterAbort24h === 0 ? 'green' : 'red',
      },
      auditExportLagSec: {
        seconds: auditExportLagSec,
        rag: auditExportLagSec < 300 ? 'green' : auditExportLagSec < 1800 ? 'yellow' : 'red',
      },
      kms: {
        state: kmsBreaker?.state ?? 'closed',
        lastFailureAt: kmsBreaker?.lastFailureAt ?? null,
        rag: kmsBreaker?.state === 'open' ? 'red' : kmsBreaker?.state === 'half_open' ? 'yellow' : 'green',
      },
    };
  }
}

function ragForMode(mode: string, autoEntered: boolean): 'green' | 'yellow' | 'red' {
  if (mode === 'normal') return 'green';
  if (mode === 'degraded') return 'yellow';
  if (mode === 'release_restricted') return autoEntered ? 'yellow' : 'red';
  return 'red'; // audit_compromised / emergency_freeze
}
