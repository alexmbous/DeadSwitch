import pino from 'pino';
import { POLICY } from '../modules/safety/policy-version';

/**
 * Centralized pino logger. Every worker and the API import this singleton.
 *
 * Every log line carries:
 *   service, role, env, policyVersion, correlationId?, userId?, scenarioId?, releaseId?
 *
 * Redaction is enforced at the pino layer (deny-list) AND at the log-schema
 * layer (see log-schema.ts). The schema layer rejects unknown keys at log
 * sites that opt into strict mode.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'deadswitch',
    role: process.env.PROCESS_ROLE ?? 'api',
    env: process.env.NODE_ENV ?? 'development',
    policyVersion: POLICY.version,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      '*.plaintext',
      '*.wrappedDek',
      '*.tokenHash',
      '*.tokenIndex',
      '*.rawToken',
      '*.sealedDek',
      '*.accessCode',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function child(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
