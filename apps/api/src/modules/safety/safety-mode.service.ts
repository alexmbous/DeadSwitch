import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, SafetyMode, SafetyModeKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Capability, evaluate } from './safety-policy';
import { POLICY } from './policy-version';
import { logger } from '../../observability/logger';

export class SafetyBlockedError extends ForbiddenException {
  readonly blocked = true;
  constructor(public capability: Capability, reason: string) {
    super(reason);
  }
}

/**
 * Single source of truth for the current fail-safe mode.
 *
 * - Cached in memory with a 5s refresh so every hot-path check is O(1).
 * - Mutations go through dedicated transition methods that write through
 *   to Postgres AND emit a SafetyModeTransition audit row IN THE SAME TX.
 * - Auto-exit from audit_compromised / emergency_freeze is rejected at
 *   the DB layer (see migration).
 *
 * A fresh process boot reads from DB before serving traffic (onModuleInit).
 */
@Injectable()
export class SafetyModeService implements OnModuleInit {
  private readonly log = new Logger(SafetyModeService.name);
  private cached: SafetyMode | null = null;
  private lastFetchAt = 0;
  private readonly refreshMs = 5_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.current();
    this.log.log(`safety mode booted: ${this.cached?.mode}`);
  }

  /** Fast path: returns cached state, refreshed every refreshMs. */
  async current(): Promise<SafetyMode> {
    const now = Date.now();
    if (this.cached && now - this.lastFetchAt < this.refreshMs) return this.cached;
    const row = await this.prisma.safetyMode.findUnique({ where: { id: 'global' } });
    this.cached = row ?? (await this.seed());
    this.lastFetchAt = now;
    return this.cached!;
  }

  /** Force a synchronous refetch — called after we ourselves mutate state. */
  async refresh(): Promise<SafetyMode> {
    this.cached = null;
    this.lastFetchAt = 0;
    return this.current();
  }

  /**
   * Asserts capability under the current mode. Throws SafetyBlockedError
   * with a stable reason string so interlock violations are surfaced the
   * same way everywhere.
   */
  async assert(capability: Capability): Promise<void> {
    const { mode } = await this.current();
    const decision = evaluate(mode, capability);
    if (!decision.allow) {
      logger.warn({ capability, mode, reason: decision.reason }, 'safety.blocked');
      throw new SafetyBlockedError(capability, decision.reason);
    }
  }

  async isProviderIsolated(providerKey: string): Promise<boolean> {
    const { isolatedProviders } = await this.current();
    return isolatedProviders.includes(providerKey);
  }

  // -------- transitions (app-layer; DB triggers also guard) --------

  async enter(
    next: SafetyModeKind,
    reason: string,
    actor: string,
    opts: { auto?: boolean } = {},
  ): Promise<SafetyMode> {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.safetyMode.findUnique({ where: { id: 'global' } });
      const from = cur?.mode ?? 'normal';
      if (from === next) return cur!;

      // Prevent silent auto-exit from the two most protective modes — the
      // DB trigger also enforces this, but we fail fast here with a typed
      // error.
      if (
        opts.auto &&
        (from === 'audit_compromised' || from === 'emergency_freeze') &&
        next === 'normal'
      ) {
        throw new ForbiddenException(
          `cannot auto-exit ${from} — dual-control required`,
        );
      }

      const updated = await tx.safetyMode.update({
        where: { id: 'global' },
        data: {
          mode: next,
          reason,
          enteredBy: actor,
          enteredAt: new Date(),
          autoEntered: !!opts.auto,
        },
      });
      await tx.safetyModeTransition.create({
        data: {
          from,
          to: next,
          reason,
          actor,
          autoEntered: !!opts.auto,
          policyVersion: POLICY.version,
        },
      });
      // Audit chain on the user scope ("global" uses a synthetic system uid
      // reserved for this kind of org-wide event).
      await this.audit.record({
        userId: SYSTEM_USER_ID,
        actor: opts.auto ? 'system' : 'admin',
        eventType: 'safety.mode.transition',
        payload: { from, to: next, reason, auto: !!opts.auto, actor },
      });
      return updated;
    }).finally(() => this.refresh());
  }

  async isolateProvider(providerKey: string, reason: string, actor: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cur = await tx.safetyMode.findUnique({ where: { id: 'global' } });
      if (!cur) return;
      if (cur.isolatedProviders.includes(providerKey)) return;
      await tx.safetyMode.update({
        where: { id: 'global' },
        data: { isolatedProviders: [...cur.isolatedProviders, providerKey] },
      });
      await this.audit.record({
        userId: SYSTEM_USER_ID,
        actor: 'system',
        eventType: 'safety.provider.isolated',
        payload: { providerKey, reason, actor },
      });
    });
    await this.refresh();
  }

  async unisolateProvider(providerKey: string, actor: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cur = await tx.safetyMode.findUnique({ where: { id: 'global' } });
      if (!cur) return;
      const next = cur.isolatedProviders.filter((p: string) => p !== providerKey);
      if (next.length === cur.isolatedProviders.length) return;
      await tx.safetyMode.update({
        where: { id: 'global' },
        data: { isolatedProviders: next },
      });
      await this.audit.record({
        userId: SYSTEM_USER_ID,
        actor: 'system',
        eventType: 'safety.provider.unisolated',
        payload: { providerKey, actor },
      });
    });
    await this.refresh();
  }

  private async seed(): Promise<SafetyMode> {
    return this.prisma.safetyMode.upsert({
      where: { id: 'global' },
      create: { id: 'global', mode: 'normal' },
      update: {},
    });
  }
}

/**
 * Synthetic user id used for org-wide audit events that have no natural
 * user owner. Reserved — must never be used for login.
 */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
