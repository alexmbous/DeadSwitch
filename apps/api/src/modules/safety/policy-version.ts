import * as crypto from 'crypto';
import { canonicalMatrix, CAPABILITIES } from './capability-matrix';

/**
 * Runtime policy version.
 *
 * Computed once at module load by hashing the canonical matrix dump. The
 * hash is included in:
 *  - every structured log line (via logger base fields)
 *  - every SafetyModeTransition audit entry
 *  - the dashboard overview
 *
 * Any change to the matrix (even a comment-level change that alters stable
 * serialization) bumps the hash. Deployments should log the policy version
 * at boot; a mismatch between expected and actual policy version must be
 * treated as "untrusted binary" and refused promotion by CI.
 *
 * The CANONICAL input is the output of canonicalMatrix() plus the ordered
 * capability list. The format string 'v1' prefixes everything so we can
 * rev the hashing scheme itself if ever needed.
 */
function compute(): { version: string; hash: string } {
  const body = `v1|caps=${CAPABILITIES.slice().sort().join(',')}|matrix=${canonicalMatrix()}`;
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  // Human-short label: first 12 hex chars.
  return { version: `p1:${hash.slice(0, 12)}`, hash };
}

export const POLICY = compute();
