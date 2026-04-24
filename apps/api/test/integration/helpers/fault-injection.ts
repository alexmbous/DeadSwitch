/**
 * Process-wide fault registry. Tests install "faults" keyed by provider +
 * optional match predicate; fake providers consult the registry before
 * returning a synthetic result.
 *
 * A fault is consumed on match unless `persistent: true`. This gives tests
 * a way to inject a single transient failure and then observe retry success.
 */

import {
  AmbiguousOutcome,
  ClientError,
  ConfigError,
  TransientInfraError,
} from '../../../src/modules/providers/error-classifier';

export type FaultKind =
  | 'transient'
  | 'permanent_client'
  | 'ambiguous'
  | 'config'
  | 'timeout'
  | 'crash_after_ack';

export interface Fault {
  provider: 'sendgrid' | 'twilio-sms' | 'twilio-voice' | 'kms-decrypt';
  kind: FaultKind;
  match?: (args: Record<string, unknown>) => boolean;
  persistent?: boolean;
  // For crash_after_ack: still return a synthetic message id so the test
  // can verify the post-ACK race handling path.
  syntheticMessageId?: string;
  // For readable assertions.
  label?: string;
}

const faults: Fault[] = [];
const triggerLog: Array<{ at: Date; fault: Fault }> = [];

export function injectFault(f: Fault): void {
  faults.push(f);
}

export function clearFaults(): void {
  faults.length = 0;
  triggerLog.length = 0;
}

export function faultsTriggered(): ReadonlyArray<{ at: Date; fault: Fault }> {
  return triggerLog.slice();
}

/**
 * Called by fake providers. Returns null if no fault fires. Throws the
 * matching provider error otherwise.
 */
export function maybeFire(
  provider: Fault['provider'],
  args: Record<string, unknown>,
): null | { syntheticMessageId?: string } {
  for (let i = 0; i < faults.length; i++) {
    const f = faults[i];
    if (f.provider !== provider) continue;
    if (f.match && !f.match(args)) continue;
    if (!f.persistent) faults.splice(i, 1);
    triggerLog.push({ at: new Date(), fault: f });

    switch (f.kind) {
      case 'transient':
        throw new TransientInfraError(`[inject ${f.label ?? 'transient'}]`);
      case 'permanent_client':
        throw new ClientError(`[inject ${f.label ?? 'permanent'}]`);
      case 'ambiguous':
        throw new AmbiguousOutcome(`[inject ${f.label ?? 'ambiguous'}]`);
      case 'config':
        throw new ConfigError(`[inject ${f.label ?? 'config'}]`);
      case 'timeout':
        throw new AmbiguousOutcome(`[inject timeout: socket hang up]`);
      case 'crash_after_ack':
        // Return a message id but immediately throw — tests detect the
        // post-ACK race via sent_after_abort state.
        return { syntheticMessageId: f.syntheticMessageId ?? `synth-${Date.now()}` };
    }
  }
  return null;
}
