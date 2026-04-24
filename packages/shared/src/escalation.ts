export type EscalationStepKind = 'push' | 'sms' | 'call' | 'contact_alert';

export interface EscalationStep {
  kind: EscalationStepKind;
  waitSeconds: number;
  retries?: number;
}

export interface EscalationPolicy {
  id: string;
  userId: string;
  name: string;
  steps: EscalationStep[];
  defaults: boolean;
}

export const DEFAULT_ESCALATION: EscalationStep[] = [
  { kind: 'push', waitSeconds: 600 },
  { kind: 'sms', waitSeconds: 1800 },
  { kind: 'call', waitSeconds: 900, retries: 2 },
  { kind: 'contact_alert', waitSeconds: 0 },
];
