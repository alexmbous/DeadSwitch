import { ScenarioState, ReleaseActionState } from '@prisma/client';

export const TERMINAL_SCENARIO_STATES: readonly ScenarioState[] = [
  'released',
  'aborted',
  'expired',
] as const;

export const TERMINAL_ACTION_STATES: readonly ReleaseActionState[] = [
  'executed',
  'failed_permanent',
  'aborted',
  'suppressed',
  'sent_after_abort',
] as const;

export function isTerminalScenario(state: ScenarioState): boolean {
  return TERMINAL_SCENARIO_STATES.includes(state);
}

export function isTerminalAction(state: ReleaseActionState): boolean {
  return TERMINAL_ACTION_STATES.includes(state);
}

export class InvariantViolationError extends Error {
  readonly kind = 'invariant';
  constructor(public code: string, message: string) {
    super(message);
  }
}
