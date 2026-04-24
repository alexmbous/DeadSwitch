import * as Crypto from 'expo-crypto';
import { getBioProtected, putBioProtected } from './secureStore';

/**
 * Versioned password-based KDF.
 *
 * WEB DEMO BUILD: only PBKDF2 (v1) is compiled. The v2 Argon2id path relies
 * on a native module that requires an Expo prebuild dev client and won't
 * bundle for web. Re-introduce in a native-targeted build.
 */

const KEK_SLOT = 'dd.kek';
const SALT_SLOT = 'dd.kek.salt';
const VERSION_SLOT = 'dd.kek.version';

export const CURRENT_KDF_VERSION = 1;

export async function deriveAndStoreKEK(
  password: string,
  version: number = CURRENT_KDF_VERSION,
): Promise<Uint8Array> {
  const saltHex =
    (await getBioProtected(SALT_SLOT)) ?? bytesToHex(Crypto.getRandomBytes(16));
  await putBioProtected(SALT_SLOT, saltHex);
  await putBioProtected(VERSION_SLOT, String(version));

  const salt = hexToBytes(saltHex);
  const kek = await pbkdf2(password, salt, 200_000, 32);
  await putBioProtected(KEK_SLOT, bytesToHex(kek));
  return kek;
}

export async function getCachedKEK(): Promise<Uint8Array | null> {
  const hex = await getBioProtected(KEK_SLOT);
  return hex ? hexToBytes(hex) : null;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Promise<Uint8Array> {
  const pw = new TextEncoder().encode(password);
  const blocks = Math.ceil(dkLen / 32);
  const out = new Uint8Array(dkLen);
  for (let i = 1; i <= blocks; i++) {
    const block = await pbkdf2Block(pw, salt, iterations, i);
    out.set(block.subarray(0, Math.min(32, dkLen - (i - 1) * 32)), (i - 1) * 32);
  }
  return out;
}

async function pbkdf2Block(
  pw: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  blockIndex: number,
): Promise<Uint8Array> {
  const first = new Uint8Array(salt.length + 4);
  first.set(salt);
  first[salt.length + 0] = (blockIndex >>> 24) & 0xff;
  first[salt.length + 1] = (blockIndex >>> 16) & 0xff;
  first[salt.length + 2] = (blockIndex >>> 8) & 0xff;
  first[salt.length + 3] = blockIndex & 0xff;
  let u = await hmacSha256(pw, first);
  const t = new Uint8Array(u);
  for (let i = 1; i < iterations; i++) {
    u = await hmacSha256(pw, u);
    for (let j = 0; j < 32; j++) t[j] ^= u[j];
  }
  return t;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const block = 64;
  let k = key;
  if (k.length > block) {
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, k);
    k = new Uint8Array(digest);
  }
  if (k.length < block) {
    const p = new Uint8Array(block);
    p.set(k);
    k = p;
  }
  const oKey = new Uint8Array(block);
  const iKey = new Uint8Array(block);
  for (let i = 0; i < block; i++) {
    oKey[i] = k[i] ^ 0x5c;
    iKey[i] = k[i] ^ 0x36;
  }
  const inner = new Uint8Array(iKey.length + data.length);
  inner.set(iKey);
  inner.set(data, iKey.length);
  const innerHash = new Uint8Array(
    await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, inner),
  );
  const outer = new Uint8Array(oKey.length + innerHash.length);
  outer.set(oKey);
  outer.set(innerHash, oKey.length);
  return new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, outer));
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
