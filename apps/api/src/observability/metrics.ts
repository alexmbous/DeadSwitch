import client from 'prom-client';

/**
 * Prometheus metrics. Exposed at GET /metrics (controller below). Each worker
 * binary exports its own /metrics too (port controlled by METRICS_PORT).
 *
 * Conventions:
 *  - All counter names snake_case, unit-suffixed (_total, _seconds).
 *  - High-cardinality labels (userId, scenarioId) are FORBIDDEN. Use reason /
 *    outcome / route / state labels only.
 */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const stateTransitions = new client.Counter({
  name: 'deadswitch_state_transitions_total',
  help: 'Scenario state transitions attempted.',
  labelNames: ['transition', 'outcome'] as const, // outcome = committed | cas_miss | invariant
  registers: [registry],
});

export const casConflicts = new client.Counter({
  name: 'deadswitch_cas_conflicts_total',
  help: 'Compare-and-swap conflicts across the system.',
  labelNames: ['entity', 'reason'] as const,
  registers: [registry],
});

export const releaseActions = new client.Counter({
  name: 'deadswitch_release_actions_total',
  help: 'Release action outcomes.',
  labelNames: ['outcome'] as const,
  // outcome ∈ executed | failed_temporary | failed_permanent | aborted | suppressed | sent_after_abort | ambiguous
  registers: [registry],
});

export const providerSends = new client.Histogram({
  name: 'deadswitch_provider_send_seconds',
  help: 'Wall time of provider send calls.',
  labelNames: ['provider', 'outcome'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const outboxLag = new client.Gauge({
  name: 'deadswitch_outbox_lag_seconds',
  help: 'Age of the oldest unshipped outbox row.',
  registers: [registry],
});

export const queueBacklog = new client.Gauge({
  name: 'deadswitch_queue_backlog',
  help: 'BullMQ backlog size per queue / state.',
  labelNames: ['queue', 'state'] as const,
  registers: [registry],
});

export const auditExportLag = new client.Gauge({
  name: 'deadswitch_audit_export_lag_seq',
  help: 'Seq gap between newest audit event and last exported.',
  labelNames: ['scope_kind'] as const,
  registers: [registry],
});

export const jobRetries = new client.Counter({
  name: 'deadswitch_job_retries_total',
  help: 'Retry counter per queue/job.',
  labelNames: ['queue', 'job_name'] as const,
  registers: [registry],
});
