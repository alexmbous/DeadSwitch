import * as crypto from 'crypto';

/**
 * Crypto primitives shared by AttachmentReleaseIssuer (release-worker) and
 * AttachmentDownloadService (API).
 *
 * Threat model:
 *   - Attacker with raw token only          → cannot derive KEK without pepper
 *   - Attacker with DB only                 → no rawToken; KEK undiscoverable
 *   - Attacker with DB + pepper             → still needs rawToken (HMAC index
 *                                             guesses are 2^256-bound)
 *   - Attacker with rawToken + pepper       → can decrypt sealedDek for ONE
 *                                             attachment + recipient + release
 *
 * The pepper (RECIPIENT_TOKEN_HMAC_KEY, reused from RecipientsService) is
 * required in production by config/env.ts.
 */

const KEK_INFO = Buffer.from('attachment-token-kek/v1', 'utf8');
const SEAL_AAD_PREFIX = 'attach-tok|v1|';

export function deriveKek(rawToken: string, salt: Buffer, pepper: Buffer): Buffer {
  const ikm = Buffer.concat([Buffer.from(rawToken, 'utf8'), pepper]);
  // hkdfSync returns ArrayBuffer; wrap as Buffer for downstream use.
  const out = crypto.hkdfSync('sha256', ikm, salt, KEK_INFO, 32);
  return Buffer.from(out);
}

export function sealDek(args: {
  plainDek: Buffer;
  kek: Buffer;
  tokenIndex: string;
  attachmentId: string;
}): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', args.kek, nonce);
  cipher.setAAD(Buffer.from(`${SEAL_AAD_PREFIX}${args.tokenIndex}|${args.attachmentId}`, 'utf8'));
  const body = Buffer.concat([cipher.update(args.plainDek), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce };
}

export function openDek(args: {
  sealed: Buffer;
  nonce: Buffer;
  kek: Buffer;
  tokenIndex: string;
  attachmentId: string;
}): Buffer {
  const tag = args.sealed.subarray(args.sealed.length - 16);
  const body = args.sealed.subarray(0, args.sealed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', args.kek, args.nonce);
  decipher.setAAD(Buffer.from(`${SEAL_AAD_PREFIX}${args.tokenIndex}|${args.attachmentId}`, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Parse the on-disk attachment blob layout:
 *   [u16 BE nonceLen][nonce][u16 BE wrappedDekLen][wrappedDek][ciphertext+tag]
 * Returns its three parts. Throws on malformed layout.
 */
export function parseAttachmentBlob(blob: Buffer): {
  nonce: Buffer;
  wrappedDek: Buffer;
  ciphertext: Buffer;
} {
  if (blob.length < 2) throw new Error('attachment blob: truncated header');
  const nonceLen = blob.readUInt16BE(0);
  const nonceStart = 2;
  const nonceEnd = nonceStart + nonceLen;
  if (blob.length < nonceEnd + 2) throw new Error('attachment blob: truncated dek header');
  const dekLen = blob.readUInt16BE(nonceEnd);
  const dekStart = nonceEnd + 2;
  const dekEnd = dekStart + dekLen;
  if (blob.length < dekEnd + 16) throw new Error('attachment blob: truncated ciphertext');
  return {
    nonce: blob.subarray(nonceStart, nonceEnd),
    wrappedDek: blob.subarray(dekStart, dekEnd),
    ciphertext: blob.subarray(dekEnd),
  };
}

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Constant-time hex string compare. Safe to use on the ciphertextHash
 * verification path; both inputs are server-known but we still avoid timing
 * leaks by reflex.
 */
export function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Pepper resolution mirrors RecipientsService — same env var, same fallback,
 * so a single rotation rotates both attachment and vault tokens.
 */
export function resolvePepper(rawEnv: string | undefined): Buffer {
  if (!rawEnv || rawEnv.length < 32) {
    return crypto.createHash('sha256').update(rawEnv ?? 'deaddrop-dev-hmac').digest();
  }
  return Buffer.from(rawEnv, 'utf8');
}
