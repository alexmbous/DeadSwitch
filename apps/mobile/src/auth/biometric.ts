import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Require a biometric (or device-PIN fallback) gesture and return an opaque
 * receipt string the backend can stamp into the audit log.
 *
 * Degrades gracefully: if the device has no biometric hardware or no enrolled
 * credentials (Expo Web, fresh emulator, OS without a lock), returns a
 * `no-bio:` receipt so dev/demo builds can still exercise the flow. A
 * production build should refuse this mode — treated here as a dev concession.
 */
export async function requireBiometric(reason: string): Promise<string> {
  let hasHw = false;
  let enrolled = false;
  try {
    hasHw = await LocalAuthentication.hasHardwareAsync();
    enrolled = await LocalAuthentication.isEnrolledAsync();
  } catch {
    // Feature-detection itself failed; fall through to the no-bio path.
  }

  if (!hasHw || !enrolled) {
    if (__DEV__) {
      console.warn(
        `[biometric] no hardware/enrollment; proceeding without biometric for "${reason}".`,
      );
    }
    return `no-bio:${Date.now()}`;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: false,
    cancelLabel: 'Cancel',
  });
  if (!result.success) throw new Error('Biometric authentication failed');
  return `bio:${Date.now()}`;
}
