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

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string }>(
        '/auth/login',
        { email, password },
      );
      await saveTokens(res.accessToken, res.refreshToken);
      await deriveAndStoreKEK(password);
      router.replace('/(app)');
    } catch (e) {
      Alert.alert('Sign in failed', (e as Error).message);
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
        <Display style={{ marginTop: spacing.md }}>Sign in</Display>
        <BodyMuted style={{ marginTop: spacing.xs }}>
          Your vault is encrypted on this device. Your password is never sent in cleartext.
        </BodyMuted>
      </View>

      <Card>
        <Field
          label="Email"
          placeholder="you@domain.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          containerStyle={{ marginBottom: spacing.md }}
        />
        <Field
          label="Password"
          placeholder="Your password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          autoComplete="password"
          containerStyle={{ marginBottom: spacing.lg }}
        />
        <Button title={loading ? 'Signing in…' : 'Sign in'} onPress={submit} loading={loading} />
      </Card>

      <Pressable
        style={styles.linkRow}
        onPress={() => router.push('/(auth)/register')}
      >
        <Label>New to DeadSwitch?</Label>
        <Small style={{ color: colors.text, marginTop: 2 }}>Create an account →</Small>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { marginBottom: spacing.xl },
  linkRow: { marginTop: spacing.xl, alignItems: 'center' },
});
