import * as Crypto from 'expo-crypto';
import { getCachedKEK } from './kek';

/**
 * Client-side AES-GCM encryption for private vault items.
 *
 * Note: React Native does not ship Web Crypto AES-GCM in every runtime. In
 * production, install `react-native-quick-crypto` or `expo-crypto` with a
 * native AES-GCM module. This scaffold delegates to `globalThis.crypto.subtle`
 * when present; otherwise callers must fail loud rather than silently fall
 * back to weaker encryption.
 */
export interface SealedVaultItem {
  ciphertextBase64: string;
  nonceBase64: string;
  wrappedDekBase64: string;
  clientKeyId: string;
}

export async function sealForVault(
  plaintext: Uint8Array,
  clientKeyId: string,
): Promise<SealedVaultItem> {
  const kek = await getCachedKEK();
  if (!kek) throw new Error('KEK not available — unlock with password first');
  const subtle = (globalThis as any).crypto?.subtle as SubtleCrypto | undefined;
  if (!subtle) {
    throw new Error(
      'WebCrypto AES-GCM not available. Install react-native-quick-crypto.',
    );
  }

  const dek = Crypto.getRandomBytes(32);
  const nonce = Crypto.getRandomBytes(12);
  const dekKey = await subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, dekKey, plaintext),
  );

  const kekKey = await subtle.importKey('raw', kek, 'AES-GCM', false, ['encrypt']);
  const wrapNonce = Crypto.getRandomBytes(12);
  const wrapped = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: wrapNonce }, kekKey, dek),
  );
  const wrappedWithNonce = new Uint8Array(wrapNonce.length + wrapped.length);
  wrappedWithNonce.set(wrapNonce);
  wrappedWithNonce.set(wrapped, wrapNonce.length);

  return {
    ciphertextBase64: toB64(ct),
    nonceBase64: toB64(nonce),
    wrappedDekBase64: toB64(wrappedWithNonce),
    clientKeyId,
  };
}

function toB64(b: Uint8Array): string {
  // Minimal base64 encoder without Buffer — RN lacks Buffer by default.
  const bin = Array.from(b)
    .map((v) => String.fromCharCode(v))
    .join('');
  // btoa is available in RN on newer Hermes.
  return (globalThis as any).btoa ? (globalThis as any).btoa(bin) : polyfillBtoa(bin);
}

function polyfillBtoa(bin: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bin.length; i += 3) {
    const a = bin.charCodeAt(i);
    const b = i + 1 < bin.length ? bin.charCodeAt(i + 1) : -1;
    const c = i + 2 < bin.length ? bin.charCodeAt(i + 2) : -1;
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | (b === -1 ? 0 : b >> 4)];
    out += b === -1 ? '=' : alphabet[((b & 15) << 2) | (c === -1 ? 0 : c >> 6)];
    out += c === -1 ? '=' : alphabet[c & 63];
  }
  return out;
}
