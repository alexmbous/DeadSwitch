import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '@/api/client';
import { useScenarios } from '@/scenarios/state';
import {
  Banner,
  Body,
  BodyMuted,
  Button,
  Card,
  CardDivider,
  Heading,
  Label,
  MetaRow,
  Mono,
  Screen,
  Section,
  Small,
  colors,
  formatDuration,
  radii,
  spacing,
} from '@/ui';

type RecipientKind = 'email' | 'sms' | 'secure_link' | 'social_handle';

type BundleRecipient = {
  id: string;
  recipientKind: RecipientKind;
  address: string;
  displayName?: string | null;
};

type Bundle = {
  id: string;
  title: string;
  recipients: BundleRecipient[];
};

type Attachment = {
  id: string;
  blobRef: string;
  ciphertextHash: string;
  sizeBytes: number;
  mimeType: string;
  displayFilename?: string;
  filename?: string;
  encryptionMode: string;
  createdAt: string;
};

type MessagePreview = {
  id: string;
  channel: 'email' | 'sms' | 'social';
  subject?: string | null;
};

/**
 * Release Preview — focused, contract-style screen showing exactly what
 * will be sent on release. No actions other than "back". This screen
 * exists so the owner can answer "what is about to happen" without
 * scrolling past unrelated controls.
 */
export default function ReleasePreview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { scenarios, load } = useScenarios();
  const scenario = useMemo(() => scenarios.find((s) => s.id === id), [scenarios, id]);

  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [messages, setMessages] = useState<Record<string, MessagePreview[]>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const list = await api.get<Bundle[]>(`/scenarios/${id}/bundles`);
      setBundles(list);
      const [atts, msgs] = await Promise.all([
        Promise.all(
          list.map((b) =>
            api
              .get<Attachment[]>(`/bundles/${b.id}/attachments`)
              .then((x) => [b.id, x] as const)
              .catch(() => [b.id, [] as Attachment[]] as const),
          ),
        ),
        Promise.all(
          list.map((b) =>
            api
              .get<MessagePreview[]>(`/bundles/${b.id}/messages`)
              .then((x) => [b.id, x] as const)
              .catch(() => [b.id, [] as MessagePreview[]] as const),
          ),
        ),
      ]);
      setAttachments(Object.fromEntries(atts));
      setMessages(Object.fromEntries(msgs));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void refresh();
  }, [load, refresh]);

  if (!scenario) {
    return (
      <Screen title="Release preview">
        <BodyMuted>Loading scenario…</BodyMuted>
      </Screen>
    );
  }

  const totalRecipients = bundles.reduce((n, b) => n + b.recipients.length, 0);
  const totalAttachments = Object.values(attachments).reduce((n, a) => n + a.length, 0);

  return (
    <Screen
      eyebrow="Release preview"
      title={scenario.name}
      subtitle="Exactly what recipients will receive when this scenario releases. No part of this is editable here."
    >
      <Banner
        kind="info"
        eyebrow="PREVIEW ONLY"
        message="This screen does not send anything. It mirrors what would be delivered if this scenario released right now."
      />

      <View style={{ height: spacing.xl }} />

      <Section
        eyebrow="From"
        hint="Recipients see this label as the sender of their message."
      >
        <Card>
          <Body>DeadSwitch on behalf of you</Body>
          <Small style={{ color: colors.textMuted, marginTop: 2 }}>
            Sender label is fixed and cannot be customized.
          </Small>
        </Card>
      </Section>

      <Section
        eyebrow="Message"
        hint="The body is encrypted server-side; you cannot read it back from this screen."
      >
        {bundles.length === 0 && !loading ? (
          <Card>
            <BodyMuted>No bundles configured. Nothing would be sent.</BodyMuted>
          </Card>
        ) : (
          bundles.map((b) => (
            <Card key={b.id} style={{ marginBottom: spacing.sm }}>
              <Label>{b.title}</Label>
              <View style={{ height: spacing.xs }} />
              {(messages[b.id] ?? []).length === 0 ? (
                <BodyMuted>No message attached to this bundle.</BodyMuted>
              ) : (
                (messages[b.id] ?? []).map((m) => (
                  <View key={m.id} style={styles.messageRow}>
                    <Mono style={{ color: colors.textMuted, width: 56 }}>
                      {m.channel.toUpperCase()}
                    </Mono>
                    <View style={{ flex: 1 }}>
                      {m.subject ? <Body numberOfLines={1}>{m.subject}</Body> : null}
                      <Small style={{ color: colors.textMuted, marginTop: 2 }}>
                        Body sealed · plaintext not stored on this device
                      </Small>
                    </View>
                  </View>
                ))
              )}
            </Card>
          ))
        )}
      </Section>

      <Section
        eyebrow="Recipients"
        hint={
          totalRecipients === 0
            ? 'No recipients configured — nothing would be delivered.'
            : `${totalRecipients} recipient${totalRecipients === 1 ? '' : 's'} would receive this release.`
        }
      >
        <Card>
          {bundles.flatMap((b) =>
            b.recipients.map((r) => (
              <MetaRow
                key={r.id}
                kind={r.recipientKind === 'social_handle' ? 'SOCIAL' : r.recipientKind}
                title={r.displayName ?? r.address}
                meta={r.displayName ? r.address : undefined}
              />
            )),
          )}
          {totalRecipients === 0 ? (
            <BodyMuted>None configured.</BodyMuted>
          ) : null}
        </Card>
      </Section>

      <Section
        eyebrow="Attachments"
        hint={
          totalAttachments === 0
            ? 'No files attached.'
            : 'Each recipient receives a single-use, expiring secure link per file. Files are not sent as binary attachments.'
        }
      >
        {totalAttachments === 0 ? (
          <Card>
            <BodyMuted>None attached.</BodyMuted>
          </Card>
        ) : (
          bundles.map((b) =>
            (attachments[b.id] ?? []).map((a) => (
              <AttachmentAccessPreview
                key={a.id}
                filename={a.displayFilename ?? a.filename ?? a.blobRef}
                mimeType={a.mimeType}
                sizeBytes={a.sizeBytes}
              />
            )),
          )
        )}
      </Section>

      <Section
        eyebrow="What happens next"
        hint="The release pipeline runs in this order. Steps are atomic per recipient."
      >
        <Card tone="raised">
          <NextStep
            n="1"
            title="Decrypt"
            body="The release worker decrypts the message body using your vault key."
          />
          <CardDivider />
          <NextStep
            n="2"
            title="Issue secure links"
            body="A one-time, recipient-scoped link is minted per attachment. Hash and expiration are bound to that recipient."
          />
          <CardDivider />
          <NextStep
            n="3"
            title="Deliver"
            body={`Each of the ${totalRecipients} recipient${totalRecipients === 1 ? '' : 's'} receives the message via their preferred channel, with the secure links inline.`}
          />
          <CardDivider />
          <NextStep
            n="4"
            title="Close out"
            body="Trusted contacts are alerted that release has completed. The scenario is marked released and cannot re-arm."
          />
        </Card>
      </Section>

      <Section eyebrow="Settings" hint="The cadence and grace window that govern this release.">
        <Card>
          <View style={styles.settingsRow}>
            <View style={{ flex: 1 }}>
              <Label>Check-in cadence</Label>
              <Body style={{ marginTop: spacing.xxs }}>
                {formatDuration(scenario.checkinIntervalSeconds)}
              </Body>
            </View>
            <View style={{ flex: 1 }}>
              <Label>Grace period</Label>
              <Body style={{ marginTop: spacing.xxs }}>
                {formatDuration(scenario.gracePeriodSeconds)}
              </Body>
            </View>
          </View>
        </Card>
      </Section>

      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [styles.backLink, pressed && { opacity: 0.7 }]}
      >
        <Label style={{ color: colors.textMuted }}>← Back to scenario</Label>
      </Pressable>
    </Screen>
  );
}

/**
 * Per-attachment recipient-perspective view. Minimal, secure-feeling,
 * single-button — the same shape a recipient sees on a real download
 * page. Owner sees this on the preview screen so there is no ambiguity
 * about what gets sent.
 */
function AttachmentAccessPreview({
  filename,
  mimeType,
  sizeBytes,
}: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <Label>SECURE FILE LINK · PREVIEW</Label>
      <View style={{ height: spacing.sm }} />
      <Heading numberOfLines={1}>{filename}</Heading>
      <View style={{ height: spacing.xxs }} />
      <Small style={{ color: colors.textMuted }}>
        {mimeType} · {formatBytes(sizeBytes)}
      </Small>
      <View style={{ height: spacing.md }} />
      <View style={styles.expirePanel}>
        <Label style={{ color: colors.textMuted }}>EXPIRES</Label>
        <Body style={{ marginTop: spacing.xxs }}>
          7 days after the release fires · single recipient · limited uses
        </Body>
      </View>
      <View style={{ height: spacing.md }} />
      <Button title="Download" variant="secondary" disabled />
      <View style={{ height: spacing.xs }} />
      <Small style={{ color: colors.textFaint, textAlign: 'center' }}>
        Disabled in preview. Recipients tap this on their own device.
      </Small>
    </Card>
  );
}

function NextStep({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <View style={styles.nextRow}>
      <Mono style={{ color: colors.textMuted, width: 24 }}>{n}.</Mono>
      <View style={{ flex: 1 }}>
        <Body weight="600">{title}</Body>
        <Small style={{ marginTop: 2 }}>{body}</Small>
      </View>
    </View>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
  },
  settingsRow: { flexDirection: 'row', gap: spacing.lg },
  expirePanel: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
  },
  nextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
  backLink: { alignSelf: 'center', marginTop: spacing.lg, padding: spacing.sm },
});
