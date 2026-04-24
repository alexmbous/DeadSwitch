/**
 * Tiny magic-byte sniffer + filename sanitizer. Intentionally narrow — the
 * goal is "don't blindly trust client mime" rather than full content
 * inspection. Anything we don't recognize falls back to
 * application/octet-stream.
 */

interface Sig {
  mime: string;
  match: (b: Buffer) => boolean;
}

const SIGNATURES: Sig[] = [
  // %PDF
  { mime: 'application/pdf', match: (b) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  // PNG
  { mime: 'image/png',       match: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  // JPEG (FF D8 FF)
  { mime: 'image/jpeg',      match: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // GIF87a / GIF89a
  { mime: 'image/gif',       match: (b) => b.length >= 6 && /^GIF8[79]a$/.test(b.slice(0, 6).toString('ascii')) },
  // ZIP / docx / xlsx / etc. (PK\x03\x04 etc.)
  { mime: 'application/zip', match: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) },
  // RIFF (wav, webp, avi)
  { mime: 'application/octet-stream', match: (b) => b.length >= 4 && b.slice(0, 4).toString('ascii') === 'RIFF' },
];

export function sniffMime(buffer: Buffer): string {
  for (const sig of SIGNATURES) {
    if (sig.match(buffer)) return sig.mime;
  }
  // Heuristic for plain text: nearly all bytes printable or common whitespace.
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)) printable += 1;
  }
  if (sample.length > 0 && printable / sample.length > 0.95) return 'text/plain';
  return 'application/octet-stream';
}

/**
 * Filename sanitizer. Strips control bytes (0x00–0x1f, 0x7f) and
 * path-traversal-prone runes, normalizes separators, truncates to 200
 * characters. Empty/garbage names collapse to 'attachment.bin'. Output is
 * safe to embed in a Content-Disposition header (the controller still
 * RFC-encodes for transport safety).
 */
export function sanitizeFilename(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return 'attachment.bin';
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) continue;
    const ch = raw[i];
    if (ch === '\\' || ch === '/') { out += '_'; continue; }
    if (ch === ':' || ch === '*' || ch === '?' || ch === '"' ||
        ch === '<' || ch === '>' || ch === '|') { out += '_'; continue; }
    out += ch;
  }
  out = out.replace(/\.+$/g, '').trim();
  if (out.length > 200) out = out.slice(0, 200);
  return out.length === 0 ? 'attachment.bin' : out;
}

/**
 * Builds the v2 AAD string for an attachment ciphertext. Binds bundleId,
 * attachmentId, mimeType, and displayFilename so a tampered DB row cannot
 * silently re-frame the ciphertext as a different file type or name.
 */
export function buildAttachmentAadV2(args: {
  bundleId: string;
  attachmentId: string;
  mimeType: string;
  displayFilename: string;
}): string {
  return [
    'attachment',
    'v2',
    args.bundleId,
    args.attachmentId,
    args.mimeType,
    args.displayFilename,
  ].join('|');
}

export function buildAttachmentAadV1(args: {
  bundleId: string;
  attachmentId: string;
}): string {
  return `attachment|${args.bundleId}|${args.attachmentId}`;
}

export function buildAttachmentAad(args: {
  aadVersion: number;
  bundleId: string;
  attachmentId: string;
  mimeType: string;
  displayFilename: string;
}): string {
  return args.aadVersion >= 2
    ? buildAttachmentAadV2(args)
    : buildAttachmentAadV1(args);
}
