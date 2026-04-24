import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { clearTokens } from '@/auth/session';
import { clearBioProtected } from '@/crypto/secureStore';
import {
  BodyMuted,
  Button,
  Card,
  ConfirmDialog,
  Label,
  Screen,
  Section,
  Small,
  colors,
  spacing,
} from '@/ui';

export default function Settings() {
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  async function signOut() {
    await clearTokens();
    await clearBioProtected('dd.kek');
    router.replace('/(auth)/login');
  }

  return (
    <Screen eyebrow="Settings" title="Security & session" subtitle="Everything that affects the posture of this device.">
      <Section eyebrow="Device session">
        <Card>
          <Label>Signed in on this device</Label>
          <View style={{ height: spacing.xs }} />
          <BodyMuted>
            Signing out clears your local key cache. Your server-side account and armed scenarios are not
            affected.
          </BodyMuted>
          <View style={{ height: spacing.md }} />
          <Button title="Sign out" variant="destructive" onPress={() => setConfirmSignOut(true)} />
        </Card>
      </Section>

      <Section eyebrow="Coming soon" hint="These tools will live here.">
        <Card tone="raised">
          <Item label="Recovery kit" desc="Offline one-time key for emergency access." />
          <Divider />
          <Item label="Biometric policy" desc="Require biometrics for arm, disarm, and release abort." />
          <Divider />
          <Item label="Audit log" desc="Every state change, on this device and server-side." />
          <Divider />
          <Item label="Subscription" desc="Plan, billing, and retention windows." />
        </Card>
      </Section>

      <ConfirmDialog
        visible={confirmSignOut}
        eyebrow="Sign out"
        title="Sign out of this device?"
        message="You will need your password to sign in again and re-derive your vault key. Armed scenarios continue to run."
        confirmLabel="Sign out"
        destructive
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={signOut}
      />
    </Screen>
  );
}

function Item({ label, desc }: { label: string; desc: string }) {
  return (
    <View style={styles.item}>
      <Label>{label}</Label>
      <Small style={{ marginTop: 2 }}>{desc}</Small>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  item: { paddingVertical: spacing.sm },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
});
