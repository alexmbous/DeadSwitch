import { SafetyModeKind } from '@prisma/client';
import { Capability, isAllowed } from './capability-matrix';

export type { Capability } from './capability-matrix';

export type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: string };

/**
 * Matrix-backed policy evaluator. Intentionally trivial — the capability
 * matrix is the source of truth. See capability-matrix.ts.
 */
export function evaluate(mode: SafetyModeKind, capability: Capability): PolicyDecision {
  if (isAllowed(mode, capability)) return { allow: true };
  return {
    allow: false,
    reason: `capability '${capability}' is denied in mode '${mode}'`,
  };
}

/**
 * Transitions that may fire even in a locked mode — required for the state
 * machine itself to reach terminal states cleanly. Complete_release and
 * expire are system transitions; admin_killswitch is operator-driven.
 */
export const ALLOW_IN_EMERGENCY_TRANSITIONS = new Set<string>([
  'complete_release',
  'expire',
  'admin_killswitch',
]);
