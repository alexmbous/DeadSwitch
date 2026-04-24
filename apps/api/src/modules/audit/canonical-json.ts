/**
 * Deterministic JSON serialization used for audit hash chaining.
 *
 * Rules:
 *  - Object keys sorted lexicographically (UTF-16 code unit order, which is
 *    what JS sort() does by default).
 *  - No whitespace between tokens.
 *  - Strings, numbers, booleans, null encoded as RFC 8259.
 *  - Undefined, functions, symbols → error (must not appear in audit data).
 *  - Buffers / Uint8Arrays → base64 strings with a prefix `b64:` so a caller
 *    never accidentally double-encodes them.
 *  - Dates → ISO 8601 strings.
 *
 * This is stricter than stock JSON.stringify(sort) and avoids drift across
 * Node versions.
 */
export function canonicalize(value: unknown): string {
  return stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `b64:${Buffer.from(v).toString('base64')}`;
  if (Array.isArray(v)) return v.map(normalize);
  switch (typeof v) {
    case 'undefined':
    case 'function':
    case 'symbol':
      throw new Error(`canonicalize: unsupported type ${typeof v}`);
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canonicalize: non-finite number');
      return v;
    case 'string':
    case 'boolean':
    case 'bigint':
      return typeof v === 'bigint' ? v.toString() : v;
    case 'object': {
      const keys = Object.keys(v as object).sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = normalize((v as any)[k]);
      return out;
    }
  }
}

function stringify(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as object).map(
      ([k, val]) => `${JSON.stringify(k)}:${stringify(val)}`,
    );
    return `{${entries.join(',')}}`;
  }
  throw new Error('canonicalize: unreachable');
}
