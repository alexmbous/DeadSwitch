import { logger } from './logger';

/**
 * Schema-enforced logging wrapper.
 *
 * Every log *site* registers a LogSchema up front. At call time, only keys
 * listed in the schema are forwarded to pino. Unknown keys are silently
 * dropped; keys that match a "sensitive-shaped" pattern (case-insensitive
 * substring match against DENY_PATTERNS) trigger a warning log at startup
 * the FIRST time they're seen and are redacted.
 *
 * This is belt-and-suspenders with the pino `redact` configuration. pino
 * handles known shapes (e.g. `*.password`); the schema handles everything
 * else.
 */

const DENY_PATTERNS = [
  'password', 'secret', 'token', 'refresh', 'access_token', 'access-token',
  'apikey', 'api_key', 'wrapped', 'plaintext', 'tokenhash', 'tokenindex',
  'sealed', 'pin', 'access_code', 'accesscode', 'ciphertext',
];

const warnedSensitive = new Set<string>();

export interface LogSchema {
  allowed: readonly string[];
  requireCorrelationId?: boolean;
}

export type ScopedLogger = {
  info: (fields: Record<string, unknown>, msg: string) => void;
  warn: (fields: Record<string, unknown>, msg: string) => void;
  error: (fields: Record<string, unknown>, msg: string) => void;
  debug: (fields: Record<string, unknown>, msg: string) => void;
};

export function makeLogger(site: string, schema: LogSchema): ScopedLogger {
  const allowed = new Set(schema.allowed);
  const emit =
    (level: 'info' | 'warn' | 'error' | 'debug') =>
    (fields: Record<string, unknown>, msg: string) => {
      const sanitized: Record<string, unknown> = { site };
      if (schema.requireCorrelationId && !fields.correlationId) {
        logger.warn({ site }, `log site '${site}' missing correlationId`);
      }
      for (const [k, v] of Object.entries(fields)) {
        const lower = k.toLowerCase();
        if (DENY_PATTERNS.some((p) => lower.includes(p))) {
          if (!warnedSensitive.has(`${site}:${k}`)) {
            warnedSensitive.add(`${site}:${k}`);
            logger.warn({ site, key: k }, 'log site attempted sensitive-shaped field — dropped');
          }
          continue;
        }
        if (!allowed.has(k)) {
          // Unknown key — drop silently but keep a debug trace.
          logger.debug({ site, key: k }, 'log_schema: dropped unknown key');
          continue;
        }
        sanitized[k] = v;
      }
      logger[level](sanitized, msg);
    };
  return {
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    debug: emit('debug'),
  };
}
