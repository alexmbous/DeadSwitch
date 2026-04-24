import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { StateMachineService } from '../state/state.service';
import { StateTransitionDeniedError } from '../state/scenario-states';
import { OutboxService } from '../outbox/outbox.service';
import { SafetyModeService } from '../safety/safety-mode.service';

const MIN_CHECKIN_SECONDS = 60 * 15;

@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly sm: StateMachineService,
    private readonly outbox: OutboxService,
    private readonly safety: SafetyModeService,
  ) {}

  list(userId: string) {
    return this.prisma.scenario.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async get(userId: string, id: string) {
    const s = await this.prisma.scenario.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException();
    return s;
  }

  async create(userId: string, data: {
    name: string;
    description?: string;
    checkinIntervalSeconds: number;
    gracePeriodSeconds: number;
    expectedDurationSeconds?: number;
    autoExpireAt?: string;
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    if (data.checkinIntervalSeconds < MIN_CHECKIN_SECONDS) {
      throw new BadRequestException('check-in interval too short');
    }
    const minGrace = this.config.get<number>('MIN_GRACE_PERIOD_SECONDS') ?? 21_600;
    if (data.gracePeriodSeconds < minGrace) {
      throw new BadRequestException(`grace period must be >= ${minGrace}s`);
    }

    const count = await this.prisma.scenario.count({ where: { userId } });
    const maxScenarios = this.config.get<number>('MAX_SCENARIOS_PER_USER') ?? 5;
    if (count >= maxScenarios) throw new ForbiddenException('scenario limit reached');

    const scenario = await this.prisma.scenario.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        checkinIntervalSeconds: data.checkinIntervalSeconds,
        gracePeriodSeconds: data.gracePeriodSeconds,
        expectedDurationSeconds: data.expectedDurationSeconds,
        autoExpireAt: data.autoExpireAt ? new Date(data.autoExpireAt) : undefined,
      },
    });
    await this.audit.record({
      userId,
      scenarioId: scenario.id,
      actor: 'user',
      eventType: 'scenario.created',
      payload: { name: scenario.name },
    });
    return scenario;
  }

  async arm(userId: string, id: string, password: string) {
    // IL7 — rejected under audit_compromised / emergency_freeze.
    await this.safety.assert('scenario.arm');
    await this.auth.verifyPasswordProof(userId, password);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    if (user.cooldownUntil && user.cooldownUntil > new Date()) {
      throw new ForbiddenException('account cooldown in effect');
    }

    const scenario = await this.get(userId, id);

    const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
    const codeHash = await argon2.hash(raw, { type: argon2.argon2id });
    const expires = scenario.autoExpireAt ?? new Date(Date.now() + 30 * 24 * 3600 * 1000);

    const armedAt = new Date();
    const delay = scenario.checkinIntervalSeconds * 1000;
    const dueAt = new Date(armedAt.getTime() + delay);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.abortCode.create({
        data: { userId, scenarioId: id, codeHash, expiresAt: expires },
      });
      try {
        await this.sm.transition(tx, id, 'arm', { armedAt });
      } catch (e) {
        if (e instanceof StateTransitionDeniedError) {
          throw new ConflictException(e.message);
        }
        throw e;
      }
      // Outbox enqueue commits atomically with the state change.
      await this.outbox.enqueue(tx, {
        queue: 'checkins',
        jobName: 'due',
        jobId: `checkin:${id}:${dueAt.toISOString()}`,
        payload: { scenarioId: id, dueAtIso: dueAt.toISOString() },
        delayMs: delay,
      });
      return tx.scenario.findUniqueOrThrow({ where: { id } });
    });

    await this.audit.record({
      userId,
      scenarioId: id,
      actor: 'user',
      eventType: 'scenario.armed',
      payload: { nextDueAt: dueAt.toISOString() },
    });

    return { scenario: result, abortCode: raw };
  }

  async disarm(userId: string, id: string, password: string) {
    await this.auth.verifyPasswordProof(userId, password);
    const scenario = await this.get(userId, id);

    const key =
      scenario.state === 'armed'
        ? 'disarm_armed'
        : scenario.state === 'incident_pending' || scenario.state === 'escalation_in_progress'
        ? 'disarm_escalation'
        : scenario.state === 'grace_period'
        ? 'abort_grace'
        : null;
    if (!key) throw new BadRequestException(`cannot disarm from state=${scenario.state}`);

    await this.prisma.$transaction(async (tx) => {
      try {
        await this.sm.transition(tx, id, key as any, { abortedAt: new Date() });
      } catch (e) {
        if (e instanceof StateTransitionDeniedError) throw new ConflictException(e.message);
        throw e;
      }
    });
    await this.audit.record({
      userId,
      scenarioId: id,
      actor: 'user',
      eventType: 'scenario.disarmed',
      payload: { fromState: scenario.state },
    });
    return { ok: true };
  }

  async performCheckin(userId: string, id: string) {
    const scenario = await this.get(userId, id);
    const recoverableStates = ['armed', 'incident_pending', 'escalation_in_progress', 'grace_period'] as const;
    if (!recoverableStates.includes(scenario.state as any)) {
      throw new BadRequestException('scenario not active');
    }
    const now = new Date();
    const delay = scenario.checkinIntervalSeconds * 1000;
    const dueAt = new Date(now.getTime() + delay);

    await this.prisma.$transaction(async (tx) => {
      const next = await tx.checkin.findFirst({
        where: { scenarioId: id, performedAt: null },
        orderBy: { dueAt: 'asc' },
      });
      if (next) {
        await tx.checkin.update({
          where: { id: next.id },
          data: { performedAt: now, result: 'ok', method: 'app' },
        });
      }
      if (scenario.state === 'incident_pending') {
        await this.sm.transition(tx, id, 'recover_incident');
      } else if (scenario.state === 'escalation_in_progress') {
        await this.sm.transition(tx, id, 'recover_escalation');
      } else if (scenario.state === 'grace_period') {
        await this.sm.transition(tx, id, 'recover_grace');
      }
      await this.outbox.enqueue(tx, {
        queue: 'checkins',
        jobName: 'due',
        jobId: `checkin:${id}:${dueAt.toISOString()}`,
        payload: { scenarioId: id, dueAtIso: dueAt.toISOString() },
        delayMs: delay,
      });
    });

    await this.audit.record({
      userId,
      scenarioId: id,
      actor: 'user',
      eventType: 'checkin.performed',
      payload: { nextDueAt: dueAt.toISOString() },
    });

    return { nextDueAt: dueAt.toISOString() };
  }

  async deleteDraft(userId: string, id: string) {
    const scenario = await this.get(userId, id);
    if (scenario.state !== 'draft') {
      throw new BadRequestException(
        `cannot delete scenario in state=${scenario.state}. Disarm or abort first.`,
      );
    }

    // Capture on-disk blob refs before cascade wipes the DB rows.
    const atts = await this.prisma.bundleAttachment.findMany({
      where: { bundle: { scenarioId: id } },
      select: { blobRef: true },
    });

    await this.prisma.scenario.delete({ where: { id } });

    // Best-effort blob cleanup. Orphaned files are not a correctness issue —
    // row-level deletion already prevents any future decrypt — but we try to
    // remove them to keep dev disks tidy. Failures are logged, not thrown.
    const blobRoot =
      this.config.get<string>('BLOB_STORAGE_PATH') ??
      path.resolve(process.cwd(), 'data', 'blobs');
    for (const a of atts) {
      if (!a.blobRef.startsWith('local:')) continue;
      const blobPath = path.join(blobRoot, a.blobRef.slice('local:'.length));
      await fs.promises.rm(blobPath, { force: true }).catch(() => {});
    }

    await this.audit.record({
      userId,
      scenarioId: id,
      actor: 'user',
      eventType: 'scenario.deleted',
      payload: { name: scenario.name, attachmentCount: atts.length },
    });
    return { ok: true };
  }

  async abort(userId: string, id: string, abortCode: string) {
    const scenario = await this.get(userId, id);
    const codes = await this.prisma.abortCode.findMany({
      where: { userId, scenarioId: id, usedAt: null, expiresAt: { gt: new Date() } },
    });
    let matched = null as null | (typeof codes)[number];
    for (const c of codes) {
      if (await argon2.verify(c.codeHash, abortCode)) {
        matched = c;
        break;
      }
    }
    if (!matched) throw new ForbiddenException('invalid abort code');

    await this.prisma.$transaction(async (tx) => {
      await tx.abortCode.update({ where: { id: matched.id }, data: { usedAt: new Date() } });
      const key =
        scenario.state === 'grace_period'
          ? 'abort_grace'
          : scenario.state === 'escalation_in_progress' || scenario.state === 'incident_pending'
          ? 'disarm_escalation'
          : null;
      if (!key) throw new BadRequestException('abort only valid during incident/escalation/grace');
      await this.sm.transition(tx, id, key as any, { abortedAt: new Date() });
    });

    await this.audit.record({
      userId,
      scenarioId: id,
      actor: 'user',
      eventType: 'release.canceled',
      payload: { fromState: scenario.state, reason: 'abort_code' },
    });
    return { ok: true };
  }
}
