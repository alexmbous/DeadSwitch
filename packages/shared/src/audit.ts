export type AuditEventType =
  | 'scenario.created'
  | 'scenario.armed'
  | 'scenario.disarmed'
  | 'scenario.renewed'
  | 'checkin.performed'
  | 'checkin.missed'
  | 'escalation.step.sent'
  | 'escalation.step.acked'
  | 'incident.opened'
  | 'grace.started'
  | 'release.triggered'
  | 'release.action.executed'
  | 'release.action.failed'
  | 'release.canceled'
  | 'release.action.decrypt';

export interface AuditEvent {
  id: string;
  userId: string;
  scenarioId?: string;
  actor: 'user' | 'system' | 'contact' | 'release_worker';
  eventType: AuditEventType;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  occurredAt: string;
}
