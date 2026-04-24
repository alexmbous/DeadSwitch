/**
 * Canonical provider-failure taxonomy. Every provider adapter must throw one
 * of these (via classify()). Downstream code (ProviderAdapter, release
 * dispatcher, breaker) pattern-matches ONLY on these classes — never on
 * provider-specific error types.
 *
 * This is the single source of truth for failure handling policy:
 *
 *   ConfigError           fatal startup-time / auth-at-runtime → isolate + never auto-retry.
 *   ClientError           permanent per-request.               → failed_permanent, no breaker impact.
 *   TransientInfraError   retryable.                           → failed_temporary, breaker++.
 *   AmbiguousOutcome      we cannot tell.                      → failed_temporary with ambiguous flag; breaker short-fuses.
 */
export abstract class ProviderError extends Error {
  abstract readonly kind: 'config' | 'client' | 'transient' | 'ambiguous';
  abstract readonly permanent: boolean;
  abstract readonly breakerImpact: 'none' | 'failure' | 'ambiguous' | 'isolate_immediately';
}

export class ConfigError extends ProviderError {
  readonly kind = 'config' as const;
  readonly permanent = true;
  readonly breakerImpact = 'isolate_immediately' as const;
  constructor(message: string) { super(message); }
}

export class ClientError extends ProviderError {
  readonly kind = 'client' as const;
  readonly permanent = true;
  readonly breakerImpact = 'none' as const;
  constructor(message: string) { super(message); }
}

export class TransientInfraError extends ProviderError {
  readonly kind = 'transient' as const;
  readonly permanent = false;
  readonly breakerImpact = 'failure' as const;
  constructor(message: string) { super(message); }
}

export class AmbiguousOutcome extends ProviderError {
  readonly kind = 'ambiguous' as const;
  readonly permanent = false;
  readonly breakerImpact = 'ambiguous' as const;
  constructor(message: string) { super(message); }
}

/**
 * Normalizes provider-specific errors into the taxonomy. Provider adapters
 * may call this or throw the typed classes directly.
 */
export function classify(err: unknown, hints?: { statusCode?: number; providerCode?: unknown }): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = err instanceof Error ? err.message : String(err);

  const status = hints?.statusCode ?? (err as any)?.status ?? (err as any)?.statusCode;
  const code = hints?.providerCode ?? (err as any)?.code;

  // Ambiguous: socket-level interruption mid-send.
  if (/socket hang up|aborted|stream terminated|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return new AmbiguousOutcome(message);
  }
  // Auth → config class
  if (code === 'EAUTH' || status === 401 || status === 403) {
    return new ConfigError(`auth: ${message}`);
  }
  // 4xx non-429 → permanent client
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
    return new ClientError(`client ${status}: ${message}`);
  }
  // Twilio known-permanent codes
  if (code === 21211 || code === 21610 || code === 21612) {
    return new ClientError(`provider permanent ${code}: ${message}`);
  }
  // 5xx / 429 / network
  return new TransientInfraError(message);
}
