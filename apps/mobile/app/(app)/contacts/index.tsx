import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '@/api/client';
import {
  Body,
  BodyMuted,
  Button,
  Card,
  CardDivider,
  ConfirmDialog,
  Display,
  Field,
  Heading,
  Label,
  Section,
  Small,
  colors,
  spacing,
} from '@/ui';

type Contact = {
  id: string;
  name: string;
  email?: string | null;
  phoneE164?: string | null;
  relationship?: string | null;
  canRequestPause: boolean;
};

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [canPause, setCanPause] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const list = await api.get<Contact[]>('/contacts');
      setContacts(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give this contact a display name.');
      return;
    }
    if (!email.trim() && !phone.trim()) {
      Alert.alert('Reach required', 'Add an email or phone number so the contact can be reached.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<Contact>('/contacts', {
        name: name.trim(),
        email: email.trim() || undefined,
        phoneE164: phone.trim() || undefined,
        relationship: relationship.trim() || undefined,
        canRequestPause: canPause,
      });
      setContacts((prev) => [created, ...prev]);
      setName('');
      setEmail('');
      setPhone('');
      setRelationship('');
      setCanPause(true);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      Alert.alert('Add failed', msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeConfirmed(c: Contact) {
    setConfirmRemove(null);
    try {
      await api.del(`/contacts/${c.id}`);
      setContacts((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      Alert.alert('Remove failed', (e as Error).message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxxl + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.textMuted} />}
        showsVerticalScrollIndicator={false}
      >
        <Label>Trusted contacts</Label>
        <Display style={{ marginTop: spacing.xs }}>
          {contacts.length === 0 ? 'No contacts yet' : `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
        </Display>
        <BodyMuted style={{ marginTop: spacing.sm }}>
          Contacts are alerted on incident and may request a pause during the grace period. They cannot cancel a
          release.
        </BodyMuted>

        <View style={{ height: spacing.xl }} />

        <Card>
          <Section eyebrow="Add a contact">
            <Field
              label="Display name"
              placeholder="e.g. Anna Novak"
              value={name}
              onChangeText={setName}
              containerStyle={{ marginBottom: spacing.md }}
            />
            <Field
              label="Email"
              placeholder="optional"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              containerStyle={{ marginBottom: spacing.md }}
            />
            <Field
              label="Phone (E.164)"
              placeholder="+15555550123"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              containerStyle={{ marginBottom: spacing.md }}
            />
            <Field
              label="Relationship"
              placeholder="optional · e.g. sister, attorney"
              value={relationship}
              onChangeText={setRelationship}
              containerStyle={{ marginBottom: spacing.md }}
            />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Label>Pause privilege</Label>
                <Small style={{ marginTop: 2 }}>
                  Allow this contact to request a pause during grace period.
                </Small>
              </View>
              <Switch
                value={canPause}
                onValueChange={setCanPause}
                trackColor={{ true: colors.safe, false: colors.border }}
                thumbColor={colors.surfaceRaised}
              />
            </View>
            <View style={{ height: spacing.lg }} />
            <Button
              title={submitting ? 'Adding…' : 'Add contact'}
              onPress={submit}
              loading={submitting}
            />
          </Section>
        </Card>

        {error ? (
          <Card tone="danger" style={{ marginTop: spacing.md }}>
            <Body>{error}</Body>
          </Card>
        ) : null}

        <View style={{ height: spacing.xl }} />
        <Label>Registered contacts</Label>
        <View style={{ height: spacing.md }} />

        {loading && contacts.length === 0 ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : contacts.length === 0 ? (
          <Card>
            <BodyMuted>
              No contacts yet. Add the people you trust to be notified — only add people who should know.
            </BodyMuted>
          </Card>
        ) : (
          <Card>
            {contacts.map((item, i) => (
              <View key={item.id}>
                {i > 0 ? <CardDivider /> : null}
                <View style={styles.contactRow}>
                  <View style={{ flex: 1, paddingRight: spacing.md }}>
                    <Heading style={{ fontSize: 17 }}>{item.name}</Heading>
                    {item.relationship ? (
                      <Small style={{ marginTop: 2 }}>{item.relationship}</Small>
                    ) : null}
                    <View style={{ height: 6 }} />
                    {item.email ? <Body>{item.email}</Body> : null}
                    {item.phoneE164 ? <Body>{item.phoneE164}</Body> : null}
                    <View style={{ height: 6 }} />
                    <Small>
                      {item.canRequestPause ? 'May request pause' : 'Alerts only · cannot pause'}
                    </Small>
                  </View>
                  <Pressable
                    onPress={() => setConfirmRemove(item)}
                    hitSlop={10}
                  >
                    <Small style={{ color: colors.danger, fontWeight: '700' }}>REMOVE</Small>
                  </Pressable>
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!confirmRemove}
        eyebrow="Remove contact"
        title={confirmRemove ? `Remove ${confirmRemove.name}?` : ''}
        message="They will no longer be alerted on incident. This does not affect any already-armed scenarios until re-review."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && removeConfirmed(confirmRemove)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screen, paddingTop: spacing.xl },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
