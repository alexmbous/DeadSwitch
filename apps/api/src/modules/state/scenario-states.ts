import { ScenarioState } from '@prisma/client';

export type ScenarioTransition = {
  from: ScenarioState[];
  to: ScenarioState;
  actor: 'user' | 'system' | 'admin';
};

/**
 * The full set of allowed transitions. Any attempt outside this table is
 * rejected at the database layer (see StateMachineService).
 */
export const SCENARIO_TRANSITIONS: Record<string, ScenarioTransition> = {
  arm:                 { from: ['draft'],                                  to: 'armed',                  actor: 'user'   },
  disarm_armed:        { from: ['armed'],                                 to: 'aborted',                actor: 'user'   },
  expire:              { from: ['armed', 'incident_pending', 'escalation_in_progress', 'grace_period'], to: 'expired', actor: 'system' },
  miss_checkin:        { from: ['armed'],                                 to: 'incident_pending',       actor: 'system' },
  begin_escalation:    { from: ['incident_pending'],                      to: 'escalation_in_progress', actor: 'system' },
  recover_incident:    { from: ['incident_pending'],                      to: 'armed',                  actor: 'user'   },
  recover_escalation:  { from: ['escalation_in_progress'],                to: 'armed',                  actor: 'user'   },
  recover_grace:       { from: ['grace_period'],                          to: 'armed',                  actor: 'user'   },
  disarm_escalation:   { from: ['incident_pending', 'escalation_in_progress'], to: 'aborted',           actor: 'user'   },
  begin_grace:         { from: ['escalation_in_progress'],                to: 'grace_period',           actor: 'system' },
  abort_grace:         { from: ['grace_period'],                          to: 'aborted',                actor: 'user'   },
  begin_release:       { from: ['grace_period'],                          to: 'release_in_progress',    actor: 'system' },
  complete_release:    { from: ['release_in_progress'],                   to: 'released',               actor: 'system' },
  admin_killswitch:    { from: ['release_in_progress'],                   to: 'aborted',                actor: 'admin'  },
};

export class StateTransitionDeniedError extends Error {
  constructor(public transition: string, public expectedFrom: ScenarioState[], public actual?: string) {
    super(
      `state transition "${transition}" denied: expected state in [${expectedFrom.join(',')}]` +
        (actual ? `, found ${actual}` : ' (row not found or already changed)'),
    );
  }
}
