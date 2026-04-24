import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/api/client';
import { saveTokens } from '@/auth/session';
import { deriveAndStoreKEK } from '@/crypto/kek';
import {
  BodyMuted,
  Button,
  Card,
  Display,
  Field,
  Label,
  MonoSmall,
  Screen,
  Small,
  colors,
  spacing,
} from '@/ui';

export default function Register() {
  const [email, setEmail] = useState('');
  const [phoneE164, setPhone] = useState('');
  const [displayName, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (password.length < 12) {
      Alert.alert('Password too short', 'Use at least 12 characters. This key encrypts your vault.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string }>(
        '/auth/register',
        { email, phoneE164, displayName, password },
      );
      await saveTokens(res.accessToken, res.refreshToken);
      await deriveAndStoreKEK(password);
      Alert.alert(
        'Account created',
        'A short cooldown is active before scenarios can be armed. Save your recovery key somewhere safe.',
      );
      router.replace('/(app)');
    } catch (e) {
      Alert.alert('Sign-up failed', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={styles.brand}>
        <MonoSmall style={{ color: colors.textFaint, letterSpacing: 2 }}>
          DEADDROP · SECURE
        </MonoSmall>
        <Display style={{ marginTop: spacing.md }}>Create an account</Display>
        <BodyMuted style={{ marginTop: spacing.xs }}>
          Your password derives the key that encrypts everything you store here. Choose it carefully.
        </BodyMuted>
      </View>

      <Card>
        <Field
          label="Display name"
          placeholder="How we address you"
          value={displayName}
          onChangeText={setName}
          containerStyle={{ marginBottom: spacing.md }}
        />
        <Field
          label="Email"
          placeholder="you@domain.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          containerStyle={{ marginBottom: spacing.md }}
        />
        <Field
          label="Phone (E.164)"
          placeholder="+15551234567"
          keyboardType="phone-pad"
          value={phoneE164}
          onChangeText={setPhone}
          containerStyle={{ marginBottom: spacing.md }}
          hint="Used for out-of-band recovery alerts only."
        />
        <Field
          label="Password"
          placeholder="Minimum 12 characters"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          containerStyle={{ marginBottom: spacing.lg }}
          hint="This password cannot be recovered. Store it somewhere safe."
        />
        <Button
          title={loading ? 'Creating account…' : 'Create account'}
          onPress={submit}
          loading={loading}
        />
      </Card>

      <Pressable style={styles.linkRow} onPress={() => router.back()}>
        <Label>Already have an account?</Label>
        <Small style={{ color: colors.text, marginTop: 2 }}>Sign in →</Small>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { marginBottom: spacing.xl },
  linkRow: { marginTop: spacing.xl, alignItems: 'center' },
});
