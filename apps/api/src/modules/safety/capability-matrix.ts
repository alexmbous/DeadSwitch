import { SafetyModeKind } from '@prisma/client';

/**
 * Explicit capability × mode matrix. Every cell must be explicitly declared.
 * There is NO implicit default — adding a capability without updating the
 * matrix is a TypeScript compile error because the record must be
 * exhaustive over both Capability and SafetyModeKind.
 *
 * Convention:
 *   true  = allowed in this mode
 *   false = denied in this mode
 *
 * A provider_isolated axis is orthogonal and evaluated separately by
 * SafetyModeService.isProviderIsolated().
 */
export const CAPABILITIES = [
  // Scenario lifecycle
  'scenario.arm',
  'scenario.state_mutation_user',

  // Release orchestration
  'release.begin',               // grace_period -> release_in_progress
  'release.continue_batch',      // release worker picks up next action
  'release.enqueue',             // outbox relay hands job to BullMQ

  // Decryption
  'vault.decrypt',               // action-payload decryption (release worker)

  // Provider dispatch (granular per-channel — matrix stays simple; breakers handle per-provider isolation)
  'provider.email_send',
  'provider.sms_send',
  'provider.voice_call',
  'provider.social_send',

  // Recipient access (split — see PART 6)
  'recipient.access_existing',   // GET /r/:token on an already-issued link
  'recipient.issue_link',        // cut a NEW token at release time

  // Attachment release (mirrors recipient.* but for BundleAttachment payload).
  'attachment.issue_link',       // release worker cuts an AttachmentAccessToken
  'attachment.access',           // GET /r/:token/attachments/:id on an issued link

  // Audit mutation (append-only invariant still holds; this is upstream)
  'audit.mutation',

  // Admin chokepoint actions
  'admin.exit_protective_mode',  // exit audit_compromised / emergency_freeze
  'admin.pause_provider',
  'admin.resume_provider',
  'admin.drain_releases',
  'admin.force_unlock_release',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

type FullMatrix = {
  [C in Capability]: { [M in SafetyModeKind]: boolean };
};

/**
 * The full matrix. Default reading rule: each capability row lists every
 * SafetyModeKind. Denials are written as `false`, allowances as `true`.
 * Keep formatted consistently so diffs are obvious in review.
 */
export const MATRIX: FullMatrix = {
  'scenario.arm': {
    normal: true, degraded: true,
    release_restricted: true,       // arming new scenarios is fine; release is what's restricted
    audit_compromised: false, emergency_freeze: false,
  },
  'scenario.state_mutation_user': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'release.begin': {
    normal: true, degraded: true,
    release_restricted: false,      // operator unlock required
    audit_compromised: false, emergency_freeze: false,
  },
  'release.continue_batch': {
    normal: true, degraded: true,
    release_restricted: true,       // in-flight releases finish (with reduced concurrency)
    audit_compromised: false, emergency_freeze: false,
  },
  'release.enqueue': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'vault.decrypt': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'provider.email_send': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'provider.sms_send': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'provider.voice_call': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'provider.social_send': {
    normal: true, degraded: true,
    release_restricted: false,      // public broadcast — stricter
    audit_compromised: false, emergency_freeze: false,
  },
  'recipient.access_existing': {
    // Recipients can still access ALREADY-released data in almost every
    // protective mode — punishing recipients for an operator incident is
    // wrong. Only full emergency_freeze severs this.
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: true,        // see PART 6 — intentional
    emergency_freeze: false,
  },
  'recipient.issue_link': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'attachment.issue_link': {
    // Mirrors recipient.issue_link — link issuance writes audit rows; refused
    // when audit chain is suspect or under emergency freeze.
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'attachment.access': {
    // Mirrors recipient.access_existing — recipients keep accessing already
    // released payloads in protective modes; only emergency_freeze severs.
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: true,
    emergency_freeze: false,
  },
  'audit.mutation': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false, emergency_freeze: false,
  },
  'admin.exit_protective_mode': {
    // Admins CAN always queue an exit request, but execution still runs
    // through the exit gate. This capability gates the API itself.
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: true,
    emergency_freeze: true,
  },
  'admin.pause_provider': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: true,
    emergency_freeze: true,
  },
  'admin.resume_provider': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false,       // cannot resume providers while compromised
    emergency_freeze: false,
  },
  'admin.drain_releases': {
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: true,
    emergency_freeze: true,
  },
  'admin.force_unlock_release': {
    // Intentionally forbidden in audit_compromised — we don't want a
    // compromised audit chain to be our only record of a force-unlock.
    normal: true, degraded: true,
    release_restricted: true,
    audit_compromised: false,
    emergency_freeze: false,
  },
};

export function isAllowed(mode: SafetyModeKind, capability: Capability): boolean {
  return MATRIX[capability][mode];
}

/**
 * Stable canonical dump of the matrix for hashing/versioning. Keys are
 * sorted to ensure deterministic output across platforms.
 */
export function canonicalMatrix(): string {
  const caps = [...CAPABILITIES].sort();
  const out: Record<string, Record<string, boolean>> = {};
  for (const c of caps) {
    const row = MATRIX[c];
    const modes = Object.keys(row).sort() as SafetyModeKind[];
    const sortedRow: Record<string, boolean> = {};
    for (const m of modes) sortedRow[m] = row[m];
    out[c] = sortedRow;
  }
  return JSON.stringify(out);
}
