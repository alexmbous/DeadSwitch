import { Injectable } from '@nestjs/common';
import { Prisma, ScenarioState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SCENARIO_TRANSITIONS,
  StateTransitionDeniedError,
} from './scenario-states';
import {
  InvariantViolationError,
  isTerminalScenario,
  TERMINAL_SCENARIO_STATES,
} from './invariants';
import { stateTransitions, casConflicts } from '../../observability/metrics';

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * All scenario state mutations go through this service. Guarantees:
 *
 *  1. Transition must be in the declared SCENARIO_TRANSITIONS table.
 *  2. Source state cannot be terminal (enforced here + by DB trigger).
 *  3. CAS via updateMany with state predicate — count must be exactly 1.
 *  4. Invariant post-checks run in the SAME transaction to catch bugs that
 *     would otherwise leave (state, timestamp) pairs inconsistent.
 */
@Injectable()
export class StateMachineService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(
    tx: Tx,
    scenarioId: string,
    transitionKey: keyof typeof SCENARIO_TRANSITIONS,
    extra: Partial<Prisma.ScenarioUpdateManyMutationInput> = {},
  ): Promise<{ from: ScenarioState; to: ScenarioState }> {
    const t = SCENARIO_TRANSITIONS[transitionKey];
    if (!t) throw new Error(`unknown transition: ${String(transitionKey)}`);

    // I1/I10 defence: no transition is allowed out of a terminal state even
    // if a buggy table declared one.
    for (const s of t.from) {
      if (isTerminalScenario(s)) {
        throw new InvariantViolationError(
          'terminal_in_from',
          `transition ${String(transitionKey)} lists terminal state '${s}' in 'from'`,
        );
      }
    }

    const before = await (tx as PrismaService).scenario.findUnique({
      where: { id: scenarioId },
      select: { state: true },
    });
    if (!before) throw new StateTransitionDeniedError(String(transitionKey), t.from);

    if (isTerminalScenario(before.state)) {
      throw new StateTransitionDeniedError(String(transitionKey), t.from, before.state);
    }

    const res = await (tx as PrismaService).scenario.updateMany({
      where: { id: scenarioId, state: { in: t.from } },
      data: { state: t.to, ...extra },
    });
    if (res.count !== 1) {
      stateTransitions.inc({ transition: String(transitionKey), outcome: 'cas_miss' });
      casConflicts.inc({ entity: 'scenario', reason: 'state_changed' });
      throw new StateTransitionDeniedError(String(transitionKey), t.from, before.state);
    }
    stateTransitions.inc({ transition: String(transitionKey), outcome: 'committed' });

    // Invariant post-check (I6/I7/I8). The DB CHECK backs this up, but we
    // fail with a typed error here so callers can distinguish bugs from
    // ordinary CAS misses.
    const after = await (tx as PrismaService).scenario.findUnique({
      where: { id: scenarioId },
      select: { state: true, armedAt: true, releasedAt: true, abortedAt: true },
    });
    if (!after) throw new InvariantViolationError('row_missing', 'scenario vanished mid-transition');
    if (after.state !== 'draft' && !after.armedAt) {
      throw new InvariantViolationError('armedAt_null', `state=${after.state} but armedAt is null`);
    }
    if ((after.state === 'released') !== !!after.releasedAt) {
      throw new InvariantViolationError('releasedAt_coupling', `state=${after.state} releasedAt=${after.releasedAt}`);
    }
    if ((after.state === 'aborted') !== !!after.abortedAt) {
      throw new InvariantViolationError('abortedAt_coupling', `state=${after.state} abortedAt=${after.abortedAt}`);
    }

    return { from: before.state, to: t.to };
  }

  async isIn(scenarioId: string, states: ScenarioState[]): Promise<boolean> {
    const s = await this.prisma.scenario.findUnique({
      where: { id: scenarioId },
      select: { state: true },
    });
    return !!s && states.includes(s.state);
  }

  /** Invariant I11: terminal states are absorbing. */
  static readonly TERMINAL = TERMINAL_SCENARIO_STATES;
}
