import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyModeService } from './safety-mode.service';

export class CircuitOpenError extends ForbiddenException {
  readonly circuitOpen = true;
  constructor(public provider: string, public nextProbeAt?: Date) {
    super(`circuit open for ${provider}`);
  }
}

export interface BreakerConfig {
  consecFailureThreshold: number;
  failureWindowCount: number;
  failureWindowMs: number;
  ambiguousWindowCount: number;
  ambiguousWindowMs: number;
  initialCooldownMs: number;
  maxCooldownMs: number;
}

const DEFAULTS: BreakerConfig = {
  consecFailureThreshold: 10,
  failureWindowCount: 25,
  failureWindowMs: 5 * 60_000,
  ambiguousWindowCount: 5,
  ambiguousWindowMs: 5 * 60_000,
  initialCooldownMs: 60_000,
  maxCooldownMs: 600_000,
};

const KMS: BreakerConfig = { ...DEFAULTS, consecFailureThreshold: 2, initialCooldownMs: 15_000, maxCooldownMs: 120_000 };
const VOICE: BreakerConfig = { ...DEFAULTS, consecFailureThreshold: 8, failureWindowCount: 15, ambiguousWindowCount: 3, initialCooldownMs: 90_000 };
const SOCIAL: BreakerConfig = { ...DEFAULTS, consecFailureThreshold: 15, initialCooldownMs: 120_000, maxCooldownMs: 900_000 };

const CONFIGS: Record<string, BreakerConfig> = {
  sendgrid: DEFAULTS,
  'twilio-sms': DEFAULTS,
  'twilio-voice': VOICE,
  'kms-decrypt': KMS,
  'social-*': SOCIAL,
};

function configFor(provider: string): BreakerConfig {
  return CONFIGS[provider] ?? (provider.startsWith('social-') ? SOCIAL : DEFAULTS);
}

/**
 * Authoritative per-provider circuit breaker. State lives in Postgres so it
 * survives restarts. We don't strive for perfect coordination across pods —
 * each pod maintains an in-memory counter and writes through on threshold
 * breach. The dispatcher check is DB-backed so any pod sees an "open"
 * transition emitted by any other.
 *
 * Three outcome classes from the caller:
 *   - recordSuccess(): closes the breaker or advances half_open → closed.
 *   - recordFailure(): increments consecutive + window count; opens if past
 *     either threshold. Calls isolateProvider() on open.
 *   - recordAmbiguous(): different window; short-fuses on repeated
 *     ambiguity so a flapping provider is isolated before it burns us.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly log = new Logger(CircuitBreakerService.name);
  private inMemFailures = new Map<string, number[]>();     // timestamps (ms)
  private inMemAmbiguous = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyModeService,
  ) {}

  async assertClosed(provider: string): Promise<void> {
    if (await this.safety.isProviderIsolated(provider)) {
      throw new CircuitOpenError(provider);
    }
    const st = await this.prisma.providerCircuitBreaker.findUnique({ where: { provider } });
    if (!st) return; // first call; treat as closed
    if (st.state === 'closed') return;
    if (st.state === 'open') {
      if (st.nextProbeAt && st.nextProbeAt <= new Date()) {
        // promote to half_open — first caller through gets to probe.
        const promoted = await this.prisma.providerCircuitBreaker.updateMany({
          where: { provider, state: 'open', nextProbeAt: { lte: new Date() } },
          data: { state: 'half_open', consecutiveProbes: 0 },
        });
        if (promoted.count !== 1) {
          // Lost the race — someone else is probing; treat as open.
          throw new CircuitOpenError(provider, st.nextProbeAt);
        }
        return;
      }
      throw new CircuitOpenError(provider, st.nextProbeAt ?? undefined);
    }
    // half_open: let exactly one probe through per probe-window
    // (more than one is acceptable; we accept a small burst).
    return;
  }

  async recordSuccess(provider: string): Promise<void> {
    this.inMemFailures.set(provider, []);
    this.inMemAmbiguous.set(provider, []);
    await this.prisma.providerCircuitBreaker.upsert({
      where: { provider },
      create: { provider, state: 'closed', lastSuccessAt: new Date() },
      update: {
        state: 'closed',
        failureCount: 0,
        ambiguousCount: 0,
        lastSuccessAt: new Date(),
        nextProbeAt: null,
        openedAt: null,
        reason: null,
      },
    });
    // Unisolate only if WE were the ones to isolate it (auto unisolate is
    // safe — it just means providers can send again).
    await this.safety.unisolateProvider(provider, 'system');
  }

  async recordFailure(provider: string, reason: string): Promise<void> {
    const cfg = configFor(provider);
    const now = Date.now();
    const arr = this.trimWindow(this.inMemFailures, provider, now, cfg.failureWindowMs);
    arr.push(now);

    // Update DB failure counter to reflect consecutive runs.
    const st = await this.prisma.providerCircuitBreaker.upsert({
      where: { provider },
      create: { provider, state: 'closed', failureCount: 1, lastFailureAt: new Date(), reason },
      update: { failureCount: { increment: 1 }, lastFailureAt: new Date(), reason },
    });

    const shouldOpen =
      st.failureCount + 1 >= cfg.consecFailureThreshold ||
      arr.length >= cfg.failureWindowCount ||
      st.state === 'half_open';

    if (shouldOpen) await this.open(provider, reason);
  }

  async recordAmbiguous(provider: string, reason: string): Promise<void> {
    const cfg = configFor(provider);
    const now = Date.now();
    const arr = this.trimWindow(this.inMemAmbiguous, provider, now, cfg.ambiguousWindowMs);
    arr.push(now);
    await this.prisma.providerCircuitBreaker.upsert({
      where: { provider },
      create: { provider, state: 'closed', ambiguousCount: 1, lastFailureAt: new Date(), reason },
      update: { ambiguousCount: { increment: 1 }, lastFailureAt: new Date(), reason },
    });
    if (arr.length >= cfg.ambiguousWindowCount) await this.open(provider, `ambiguous spike: ${reason}`);
  }

  private trimWindow(map: Map<string, number[]>, provider: string, now: number, windowMs: number) {
    const arr = (map.get(provider) ?? []).filter((t) => now - t <= windowMs);
    map.set(provider, arr);
    return arr;
  }

  private async open(provider: string, reason: string): Promise<void> {
    const cfg = configFor(provider);
    const st = await this.prisma.providerCircuitBreaker.findUnique({ where: { provider } });
    const lastCooldown =
      st?.openedAt && st.nextProbeAt
        ? st.nextProbeAt.getTime() - st.openedAt.getTime()
        : cfg.initialCooldownMs;
    const nextCooldown = Math.min(cfg.maxCooldownMs, Math.max(cfg.initialCooldownMs, lastCooldown * 2));
    const now = new Date();
    const probeAt = new Date(now.getTime() + nextCooldown);
    await this.prisma.providerCircuitBreaker.update({
      where: { provider },
      data: { state: 'open', openedAt: now, nextProbeAt: probeAt, reason },
    });
    await this.safety.isolateProvider(provider, reason, 'system');
    this.log.warn(`breaker OPEN ${provider} — probe at ${probeAt.toISOString()} — ${reason}`);
  }
}
