import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { api, ApiError } from '@/api/client';
import { useScenarios } from '@/scenarios/state';
import type { Scenario } from '@/scenarios/state';
import {
  Body,
  BodyMuted,
  Button,
  Card,
  CardDivider,
  Field,
  Label,
  Screen,
  Section,
  Small,
  colors,
  radii,
  spacing,
} from '@/ui';

type RecipientDraft = {
  id: string;
  kind: 'email' | 'sms';
  address: string;
  displayName: string;
};

type MessageChannel = 'email' | 'sms' | 'social';

type AttachmentDraft = {
  id: string;
  uri: string;
  name: string;
  size: number;
  mimeType: string;
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function newRecipient(kind: 'email' | 'sms' = 'email'): RecipientDraft {
  return { id: Math.random().toString(36).slice(2), kind, address: '', displayName: '' };
}

export default function NewScenario() {
  const loadScenarios = useScenarios((s) => s.load);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [checkinHours, setCheckinHours] = useState('24');
  const [graceHours, setGraceHours] = useState('72');

  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageChannel, setMessageChannel] = useState<MessageChannel>('email');

  const [recipients, setRecipients] = useState<RecipientDraft[]>([newRecipient('email')]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function pickAttachment() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const picked: AttachmentDraft[] = [];
      for (const a of result.assets) {
        const size = a.size ?? 0;
        if (size > MAX_ATTACHMENT_BYTES) {
          Alert.alert(
            'File too large',
            `"${a.name}" is ${(size / 1024 / 1024).toFixed(1)} MB. Maximum is 10 MB.`,
          );
          continue;
        }
        picked.push({
          id: Math.random().toString(36).slice(2),
          uri: a.uri,
          name: a.name,
          size,
          mimeType: a.mimeType || 'application/octet-stream',
        });
      }
      if (picked.length > 0) {
        setAttachments((prev) => [...prev, ...picked]);
      }
    } catch (e) {
      Alert.alert('Pick failed', (e as Error).message);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function updateRecipient(id: string, patch: Partial<RecipientDraft>) {
    setRecipients((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRecipient(id: string) {
    setRecipients((list) => (list.length <= 1 ? list : list.filter((r) => r.id !== id)));
  }

  async function submit() {
    const checkinSec = Math.round(Number(checkinHours) * 3600);
    const graceSec = Math.round(Number(graceHours) * 3600);
    if (!name.trim()) return Alert.alert('Name required', 'Give this scenario a short name.');
    if (!Number.isFinite(checkinSec) || checkinSec < 15 * 60) {
      return Alert.alert('Check-in too short', 'Check-in interval must be at least 15 minutes.');
    }
    if (!Number.isFinite(graceSec) || graceSec < 60 * 60) {
      return Alert.alert('Grace too short', 'Grace period must be at least 1 hour.');
    }
    if (!messageBody.trim()) {
      return Alert.alert(
        'Message required',
        'Write the message that recipients will receive on release.',
      );
    }
    const cleaned = recipients
      .map((r) => ({ ...r, address: r.address.trim(), displayName: r.displayName.trim() }))
      .filter((r) => r.address.length > 0);
    if (cleaned.length === 0) {
      return Alert.alert(
        'Add a recipient',
        'Configure at least one recipient to receive the payload.',
      );
    }
    for (const r of cleaned) {
      if (r.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.address)) {
        return Alert.alert('Invalid email', `"${r.address}" is not a valid email address.`);
      }
      if (r.kind === 'sms' && !/^\+\d{7,15}$/.test(r.address)) {
        return Alert.alert('Invalid phone', `"${r.address}" must be E.164 (e.g. +15555550123).`);
      }
    }

    setSubmitting(true);
    try {
      const scenario = await api.post<Scenario>('/scenarios', {
        name: name.trim(),
        description: description.trim() || undefined,
        checkinIntervalSeconds: checkinSec,
        gracePeriodSeconds: graceSec,
      });

      const bundle = await api.post<{ id: string }>(`/scenarios/${scenario.id}/bundles`, {
        title: `${name.trim()} · payload`,
        releaseStage: 'on_release',
        visibility: 'private',
      });

      await Promise.all(
        cleaned.map((r) =>
          api.post(`/bundles/${bundle.id}/recipients`, {
            recipientKind: r.kind,
            address: r.address,
            displayName: r.displayName || undefined,
            accessMethod: 'direct',
          }),
        ),
      );

      await api.post(`/bundles/${bundle.id}/messages`, {
        channel: messageChannel,
        subject: subject.trim() || undefined,
        plaintext: messageBody,
      });

      for (const a of attachments) {
        const form = new FormData();
        form.append('file', {
          uri: a.uri,
          name: a.name,
          type: a.mimeType,
        } as unknown as Blob);
        await api.upload(`/bundles/${bundle.id}/attachments`, form);
      }

      await loadScenarios();
      router.replace(`/(app)/scenarios/${scenario.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      Alert.alert('Create failed', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      eyebrow="New scenario"
      title="Configure release"
      subtitle="Set the check-in cadence, the message to deliver, and who receives it on release."
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1 }}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => router.back()}
              disabled={submitting}
            />
          </View>
          <View style={{ width: spacing.sm }} />
          <View style={{ flex: 1 }}>
            <Button
              title={submitting ? 'Creating…' : 'Create draft'}
              onPress={submit}
              loading={submitting}
            />
          </View>
        </View>
      }
    >
      <Section eyebrow="Basics" hint="What this scenario is and how often you must check in.">
        <Card>
          <Field
            label="Scenario name"
            placeholder="e.g. Extended travel · Southeast Asia"
            value={name}
            onChangeText={setName}
            autoFocus
            containerStyle={{ marginBottom: spacing.md }}
          />
          <Field
            label="Description (optional)"
            placeholder="A short note to your future self about when this should trigger."
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={2}
            style={{ minHeight: 64, textAlignVertical: 'top' }}
            containerStyle={{ marginBottom: spacing.md }}
          />
          <Field
            label="Check in every (hours)"
            keyboardType="numeric"
            value={checkinHours}
            onChangeText={setCheckinHours}
            hint="Minimum 15 minutes. Missing a check-in starts escalation."
            containerStyle={{ marginBottom: spacing.md }}
          />
          <Field
            label="Grace period (hours)"
            keyboardType="numeric"
            value={graceHours}
            onChangeText={setGraceHours}
            hint="Minimum 1 hour. Time you have to abort after an incident opens."
          />
        </Card>
      </Section>

      <Section
        eyebrow="Payload · message"
        hint="The text delivered to every recipient on release. Encrypted on the server; plaintext is not retained."
      >
        <Card>
          <Label>Delivery channel</Label>
          <View style={{ height: spacing.xs }} />
          <View style={styles.segmentedRow}>
            <SegmentPill
              label="Email"
              active={messageChannel === 'email'}
              onPress={() => setMessageChannel('email')}
            />
            <SegmentPill
              label="SMS"
              active={messageChannel === 'sms'}
              onPress={() => setMessageChannel('sms')}
            />
            <SegmentPill
              label="Social"
              active={messageChannel === 'social'}
              onPress={() => setMessageChannel('social')}
            />
          </View>
          <View style={{ height: spacing.md }} />
          {messageChannel === 'email' ? (
            <Field
              label="Subject"
              placeholder="Subject line for email delivery"
              value={subject}
              onChangeText={setSubject}
              containerStyle={{ marginBottom: spacing.md }}
            />
          ) : null}
          <Field
            label="Message body"
            placeholder="What you want recipients to read when this scenario releases."
            value={messageBody}
            onChangeText={setMessageBody}
            multiline
            numberOfLines={6}
            style={{ minHeight: 140, textAlignVertical: 'top' }}
            hint="Up to 20,000 characters."
          />
          <CardDivider />
          <Label>File attachments</Label>
          <View style={{ height: spacing.xs }} />
          <BodyMuted>
            Files are envelope-encrypted server-side and delivered alongside the message on
            release. Max 10 MB per file.
          </BodyMuted>
          <View style={{ height: spacing.sm }} />
          {attachments.map((a) => (
            <View key={a.id} style={styles.attachmentRow}>
              <View style={{ flex: 1, paddingRight: spacing.sm }}>
                <Body numberOfLines={1}>{a.name}</Body>
                <Small style={{ color: colors.textMuted }}>
                  {formatBytes(a.size)} · {a.mimeType}
                </Small>
              </View>
              <Pressable onPress={() => removeAttachment(a.id)} hitSlop={8}>
                <Small style={{ color: colors.danger }}>Remove</Small>
              </Pressable>
            </View>
          ))}
          <View style={{ height: spacing.sm }} />
          <Button
            title={attachments.length === 0 ? 'Attach files' : 'Attach more files'}
            variant="secondary"
            onPress={pickAttachment}
          />
        </Card>
      </Section>

      <Section
        eyebrow="Recipients"
        hint="Who receives the payload on release. You can add more than one."
      >
        <Card>
          {recipients.map((r, i) => (
            <View key={r.id}>
              <View style={styles.recipientHeader}>
                <Label>Recipient {i + 1}</Label>
                {recipients.length > 1 ? (
                  <Pressable onPress={() => removeRecipient(r.id)} hitSlop={8}>
                    <Small style={{ color: colors.danger }}>Remove</Small>
                  </Pressable>
                ) : null}
              </View>
              <View style={{ height: spacing.xs }} />
              <View style={styles.segmentedRow}>
                <SegmentPill
                  label="Email"
                  active={r.kind === 'email'}
                  onPress={() => updateRecipient(r.id, { kind: 'email' })}
                />
                <SegmentPill
                  label="SMS"
                  active={r.kind === 'sms'}
                  onPress={() => updateRecipient(r.id, { kind: 'sms' })}
                />
              </View>
              <View style={{ height: spacing.md }} />
              <Field
                label="Display name (optional)"
                placeholder="Jane Doe"
                value={r.displayName}
                onChangeText={(v) => updateRecipient(r.id, { displayName: v })}
                containerStyle={{ marginBottom: spacing.md }}
              />
              <Field
                label={r.kind === 'email' ? 'Email address' : 'Phone (E.164)'}
                placeholder={r.kind === 'email' ? 'jane@example.com' : '+15555550123'}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={r.kind === 'email' ? 'email-address' : 'phone-pad'}
                value={r.address}
                onChangeText={(v) => updateRecipient(r.id, { address: v })}
              />
              {i < recipients.length - 1 ? (
                <View style={{ marginVertical: spacing.lg }}>
                  <CardDivider />
                </View>
              ) : null}
            </View>
          ))}
          <View style={{ height: spacing.md }} />
          <Button
            title="Add another recipient"
            variant="secondary"
            onPress={() => setRecipients((list) => [...list, newRecipient('email')])}
          />
        </Card>
      </Section>

      <Section eyebrow="Next" hint="This scenario is created as a draft and does not release anything on its own.">
        <Card tone="raised">
          <Body>
            After creation, review everything on the scenario page and arm it when you&apos;re
            ready. Nothing will be sent until you explicitly arm.
          </Body>
        </Card>
      </Section>
    </Screen>
  );
}

function SegmentPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        active && styles.pillActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Label style={{ color: active ? colors.textInverse : colors.text }}>{label}</Label>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center' },
  segmentedRow: { flexDirection: 'row', gap: spacing.xs },
  pill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  recipientHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
