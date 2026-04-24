import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyModeService } from './safety-mode.service';
import { CircuitBreakerService } from './circuit-breaker.service';

/**
 * Evaluates detection rules on a tick. Called from the containment watcher
 * worker. Idempotent — calling twice produces the same resulting state.
 *
 * Each rule is deliberately simple to audit. The principle is:
 * "prefer too-conservative over too-clever".
 */
@Injectable()
export class ContainmentService {
  private readonly log = new Logger(ContainmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyModeService,
    private readonly breakers: CircuitBreakerService,
  ) {}

  /** Runs all rules. Returns a short summary for the caller to log. */
  async tick(): Promise<{ mode: string; fired: string[] }> {
    const fired: string[] = [];

    // C1: any sent_after_abort in the last 5 minutes.
    const sentAfterAbort = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.action.sent_after_abort',
        occurredAt: { gte: new Date(Date.now() - 5 * 60_000) },
      },
    });
    if (sentAfterAbort > 0) {
      await this.safety.enter(
        'release_restricted',
        `C1: sent_after_abort=${sentAfterAbort} in last 5m`,
        'system',
        { auto: true },
      );
      // Also abort remaining pending siblings of affected releases — belt-
      // and-suspenders beyond the release worker's own check.
      await this.abortSiblingsOfSentAfterAbort();
      fired.push('C1');
    }

    // C2: ambiguous action spike.
    const ambiguousCount = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.action.failed',
        occurredAt: { gte: new Date(Date.now() - 5 * 60_000) },
        payloadRedacted: { path: ['ambiguous'], equals: true },
      },
    });
    if (ambiguousCount >= 5) {
      await this.safety.enter(
        'release_restricted',
        `C2: ambiguous=${ambiguousCount} in last 5m`,
        'system',
        { auto: true },
      );
      fired.push('C2');
    }

    // C3: outbox lag.
    const oldest = await this.prisma.outboxEvent.findFirst({
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    });
    if (oldest) {
      const ageMs = Date.now() - oldest.availableAt.getTime();
      if (ageMs > 900_000) {
        await this.safety.enter('degraded', `C3: outbox lag ${Math.round(ageMs / 1000)}s`, 'system', { auto: true });
        fired.push('C3-hard');
      } else if (ageMs > 300_000) {
        // No mode change — metric alerting handles this tier.
        this.log.warn(`outbox lag ${Math.round(ageMs / 1000)}s (C3-soft)`);
      }
    }

    // C4: KMS breaker state.
    const kms = await this.prisma.providerCircuitBreaker.findUnique({ where: { provider: 'kms-decrypt' } });
    if (kms?.state === 'open') {
      await this.safety.enter('release_restricted', 'C4: KMS breaker open', 'system', { auto: true });
      fired.push('C4');
    }

    // C5: audit integrity — any chain scope whose latest seq has not been
    // exported in >1 hour AND no successful export row exists is suspicious.
    // A real gap (seq missing from export watermark) is stronger signal; see
    // the export worker for detection.
    const staleScopes = await this.prisma.$queryRawUnsafe<Array<{ scope: string; max: number; watermark: number; lagSec: number }>>(
      `SELECT ae."chainScope" as scope,
              MAX(ae."seq")::int as max,
              COALESCE(ax."exportedUpToSeq", 0)::int as watermark,
              EXTRACT(EPOCH FROM (NOW() - COALESCE(ax."lastExportedAt", NOW() - INTERVAL '100 years')))::int as "lagSec"
         FROM "AuditEvent" ae
         LEFT JOIN "AuditExport" ax ON ax."chainScope" = ae."chainScope"
         GROUP BY ae."chainScope", ax."exportedUpToSeq", ax."lastExportedAt"
         HAVING MAX(ae."seq") > COALESCE(ax."exportedUpToSeq", 0)
           AND EXTRACT(EPOCH FROM (NOW() - COALESCE(ax."lastExportedAt", NOW() - INTERVAL '100 years'))) > 3600
         LIMIT 5`,
    );
    if (staleScopes.length > 0) {
      await this.safety.enter(
        'audit_compromised',
        `C5: ${staleScopes.length} audit scope(s) unexported >1h`,
        'system',
        { auto: true },
      );
      fired.push('C5');
    }

    // C7: release trigger runaway.
    const recentReleases = await this.prisma.auditEvent.count({
      where: {
        eventType: 'release.triggered',
        occurredAt: { gte: new Date(Date.now() - 60_000) },
      },
    });
    if (recentReleases > 20) {
      await this.safety.enter(
        'release_restricted',
        `C7: release.triggered=${recentReleases} in last minute`,
        'system',
        { auto: true },
      );
      fired.push('C7');
    }

    // Auto-recovery: if we are in release_restricted (auto) and NO rule
    // fired this tick, check how long it's been clean. 30min clean window.
    const current = await this.safety.current();
    if (current.mode === 'release_restricted' && current.autoEntered && fired.length === 0) {
      const enteredMsAgo = Date.now() - current.enteredAt.getTime();
      if (enteredMsAgo > 30 * 60_000) {
        await this.safety.enter('normal', 'auto-exit: clean 30min', 'system', { auto: true });
      }
    }
    if (current.mode === 'degraded' && current.autoEntered && fired.length === 0) {
      if (Date.now() - current.enteredAt.getTime() > 15 * 60_000) {
        await this.safety.enter('normal', 'auto-exit: degraded clean', 'system', { auto: true });
      }
    }
    // Note: audit_compromised / emergency_freeze require dual-control exit.

    return { mode: current.mode, fired };
  }

  private async abortSiblingsOfSentAfterAbort() {
    // Find releases that had a sent_after_abort recently.
    const events = await this.prisma.auditEvent.findMany({
      where: {
        eventType: 'release.action.sent_after_abort',
        occurredAt: { gte: new Date(Date.now() - 5 * 60_000) },
      },
    });
    const releaseIds = new Set<string>();
    for (const e of events) {
      const payload = e.payloadRedacted as any;
      if (payload?.actionId) {
        const action = await this.prisma.releaseAction.findUnique({
          where: { id: payload.actionId },
          select: { releaseId: true },
        });
        if (action) releaseIds.add(action.releaseId);
      }
    }
    for (const releaseId of releaseIds) {
      await this.prisma.releaseAction.updateMany({
        where: { releaseId, state: { in: ['pending', 'failed_temporary'] } },
        data: { state: 'aborted', lastError: 'containment: sibling sent_after_abort' },
      });
    }
  }
}
