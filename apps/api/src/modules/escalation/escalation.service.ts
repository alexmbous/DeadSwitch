import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailProvider } from '../providers/email.provider';
import { SmsProvider } from '../providers/sms.provider';
import { VoiceProvider } from '../providers/voice.provider';
import { StateMachineService } from '../state/state.service';
import { StateTransitionDeniedError } from '../state/scenario-states';
import { OutboxService } from '../outbox/outbox.service';
import { SafetyBlockedError, SafetyModeService } from '../safety/safety-mode.service';
import { DEFAULT_ESCALATION } from '@deadswitch/shared';

/**
 * Escalation ladder orchestration. All scenario state mutations go through
 * StateMachineService; any CAS failure here is treated as "scenario moved on
 * behalf of the user" (disarm/abort/expire race) and the job exits silently.
 *
 * All downstream enqueues go through OutboxService in the same transaction
 * as their triggering state change.
 */
@Injectable()
export class EscalationService {
  private readonly log = new Logger(EscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    private readonly voice: VoiceProvider,
    private readonly sm: StateMachineService,
    private readonly outbox: OutboxService,
    private readonly safety: SafetyModeService,
  ) {}

  async handleCheckinDue(scenarioId: string, dueAtIso: string) {
    const scenario = await this.prisma.scenario.findUnique({ where: { id: scenarioId } });
    if (!scenario || scenario.state !== 'armed') return;

    await this.prisma.checkin.upsert({
      where: { scenarioId_dueAt: { scenarioId, dueAt: new Date(dueAtIso) } },
      update: {},
      create: { scenarioId, dueAt: new Date(dueAtIso), result: 'missed' },
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.sm.transition(tx, scenarioId, 'miss_checkin', { incidentOpenedAt: new Date() });
        await this.outbox.enqueue(tx, {
          queue: 'escalation',
          jobName: 'run-step',
          jobId: `esc:${scenarioId}:${dueAtIso}:0`,
          payload: { scenarioId, stepIndex: 0, dueAtIso, steps: DEFAULT_ESCALATION },
        });
      });
    } catch (e) {
      if (e instanceof StateTransitionDeniedError) return;
      throw e;
    }

    await this.audit.record({
      userId: scenario.userId,
      scenarioId,
      actor: 'system',
      eventType: 'incident.opened',
      payload: {},
    });
  }

  async runStep(input: {
    scenarioId: string;
    stepIndex: number;
    dueAtIso: string;
    steps: typeof DEFAULT_ESCALATION;
  }) {
    const { scenarioId, stepIndex, steps } = input;
    const scenario = await this.prisma.scenario.findUnique({
      where: { id: scenarioId },
      include: { user: true },
    });
    if (!scenario) return;
    if (scenario.state !== 'incident_pending' && scenario.state !== 'escalation_in_progress') return;

    if (stepIndex === 0 && scenario.state === 'incident_pending') {
      try {
        await this.prisma.$transaction((tx) => this.sm.transition(tx, scenarioId, 'begin_escalation'));
      } catch (e) {
        if (e instanceof StateTransitionDeniedError) return;
        throw e;
      }
    }

    const step = steps[stepIndex];
    if (!step) {
      await this.beginGrace(scenario.id, scenario.userId, scenario.gracePeriodSeconds);
      return;
    }

    await this.prisma.escalationAttempt.create({
      data: { scenarioId, stepIndex, channel: step.kind, status: 'sent', attemptedAt: new Date() },
    });

    try {
      if (step.kind === 'push') {
        this.log.log(`[push] scenario=${scenarioId}`);
      } else if (step.kind === 'sms' && scenario.user.phoneE164) {
        await this.sms.send(
          scenario.user.phoneE164,
          'DeadSwitch: please check in now.',
          `esc_sms:${scenarioId}:${input.dueAtIso}:${stepIndex}`,
        );
      } else if (step.kind === 'call' && scenario.user.phoneE164) {
        await this.voice.call(
          scenario.user.phoneE164,
          'DeadSwitch check-in. Press 1 to confirm.',
          `esc_voice:${scenarioId}:${input.dueAtIso}:${stepIndex}`,
        );
      } else if (step.kind === 'contact_alert') {
        const contacts = await this.prisma.trustedContact.findMany({
          where: { userId: scenario.userId, verifiedAt: { not: null } },
        });
        for (const c of contacts) {
          if (c.email) {
            await this.email.send(
              c.email,
              'DeadSwitch alert',
              `${scenario.user.displayName} is unresponsive. You may request a temporary pause.`,
              `esc_alert:${scenarioId}:${input.dueAtIso}:${c.id}`,
            );
          }
        }
      }
    } catch (err) {
      this.log.warn(`escalation step failed (non-fatal): ${(err as Error).message}`);
    }

    await this.audit.record({
      userId: scenario.userId,
      scenarioId,
      actor: 'system',
      eventType: 'escalation.step.sent',
      payload: { stepIndex, kind: step.kind },
    });

    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      await this.prisma.$transaction((tx) =>
        this.outbox.enqueue(tx, {
          queue: 'escalation',
          jobName: 'run-step',
          jobId: `esc:${scenarioId}:${input.dueAtIso}:${nextIndex}`,
          payload: { scenarioId, stepIndex: nextIndex, dueAtIso: input.dueAtIso, steps },
          delayMs: step.waitSeconds * 1000,
        }),
      );
    } else {
      await this.beginGrace(scenarioId, scenario.userId, scenario.gracePeriodSeconds);
    }
  }

  private async beginGrace(scenarioId: string, userId: string, gracePeriodSeconds: number) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.sm.transition(tx, scenarioId, 'begin_grace');
        await this.outbox.enqueue(tx, {
          queue: 'escalation',
          jobName: 'grace-expiry',
          jobId: `grace:${scenarioId}:${new Date().toISOString()}`,
          payload: { scenarioId },
          delayMs: gracePeriodSeconds * 1000,
        });
      });
    } catch (e) {
      if (e instanceof StateTransitionDeniedError) return;
      throw e;
    }
    await this.audit.record({
      userId,
      scenarioId,
      actor: 'system',
      eventType: 'grace.started',
      payload: { gracePeriodSeconds },
    });
  }

  async handleGraceExpiry(scenarioId: string) {
    const scenario = await this.prisma.scenario.findUnique({ where: { id: scenarioId } });
    if (!scenario) return;

    // IL4/IL5: do not enter release_in_progress if the global mode forbids.
    // The job stays in BullMQ as a failure so it will be retried once mode
    // returns to normal (bounded by job max-attempts).
    try {
      await this.safety.assert('release.begin');
    } catch (e) {
      if (e instanceof SafetyBlockedError) {
        this.log.warn(`begin_release blocked by safety: ${e.message}`);
        await this.audit.record({
          userId: scenario.userId,
          scenarioId,
          actor: 'system',
          eventType: 'safety.begin_release.blocked',
          payload: { reason: e.message },
        });
        throw new Error(`safety:release.begin`);
      }
      throw e;
    }

    const release = await this.prisma
      .$transaction(async (tx) => {
        try {
          await this.sm.transition(tx, scenarioId, 'begin_release');
        } catch (e) {
          if (e instanceof StateTransitionDeniedError) return null;
          throw e;
        }
        const r = await tx.release.create({
          data: { scenarioId, triggerReason: 'escalation_exhausted', state: 'executing' },
        });

        // Fan out one action per (message, recipient) with deterministic IDs,
        // all enqueued via the outbox in the same transaction.
        const bundles = await tx.releaseBundle.findMany({
          where: { scenarioId },
          include: { messages: true },
        });
        for (const b of bundles) {
          for (const m of b.messages) {
            if (!m.recipientId) continue;
            const action = await tx.releaseAction.upsert({
              where: {
                releaseId_bundleId_recipientId_messageId: {
                  releaseId: r.id,
                  bundleId: b.id,
                  recipientId: m.recipientId,
                  messageId: m.id,
                },
              },
              create: {
                releaseId: r.id,
                bundleId: b.id,
                recipientId: m.recipientId,
                messageId: m.id,
                state: 'pending',
              },
              update: {},
            });
            await this.outbox.enqueue(tx, {
              queue: 'release',
              jobName: 'execute',
              jobId: `rel:${action.id}`,
              payload: { actionId: action.id },
            });
          }
        }
        return r;
      })
      .catch(() => null);

    if (!release) return;

    await this.audit.record({
      userId: scenario.userId,
      scenarioId,
      actor: 'system',
      eventType: 'release.triggered',
      payload: { releaseId: release.id },
    });
  }
}
