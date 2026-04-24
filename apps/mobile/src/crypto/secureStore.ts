import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Wrapper that requires biometric unlock for the most sensitive slots (the
 * cached User KEK). Degrades gracefully:
 *  - With a biometric or device lock enrolled: storage is biometric-gated.
 *  - Without (Expo Web, fresh emulator, or OS with no lock): falls back to
 *    non-biometric SecureStore. Production builds should refuse this mode —
 *    it's a dev/demo concession.
 */
let cachedSupported: boolean | null = null;

async function biometricSupported(): Promise<boolean> {
  if (cachedSupported !== null) return cachedSupported;
  try {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    cachedSupported = hasHw && enrolled;
  } catch {
    cachedSupported = false;
  }
  return cachedSupported;
}

async function optsFor(): Promise<SecureStore.SecureStoreOptions> {
  const bio = await biometricSupported();
  return bio
    ? {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        requireAuthentication: true,
        authenticationPrompt: 'Unlock DeadSwitch',
      }
    : {
        // Fallback: hardware-backed but no biometric gate.
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      };
}

export async function putBioProtected(key: string, value: string) {
  await SecureStore.setItemAsync(key, value, await optsFor());
}

export async function getBioProtected(key: string) {
  return SecureStore.getItemAsync(key, await optsFor());
}

export async function clearBioProtected(key: string) {
  await SecureStore.deleteItemAsync(key);
}
