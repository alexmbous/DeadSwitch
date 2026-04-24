import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '@/api/client';
import { useScenarios } from '@/scenarios/state';
import { requireBiometric } from '@/auth/biometric';
import {
  Banner,
  Body,
  BodyMuted,
  Button,
  Card,
  CardDivider,
  ConfirmDialog,
  Field,
  Heading,
  KeyValue,
  KeyValueRow,
  Label,
  MetaRow,
  Mono,
  MonoSmall,
  Screen,
  Section,
  Sheet,
  Small,
  StateKind,
  StatusPill,
  Stepper,
  colors,
  formatDateTime,
  formatDuration,
  radii,
  relativeFromNow,
  spacing,
} from '@/ui';

type Mode = null | 'arm' | 'abort';

const ACTIVE_STATES = new Set([
  'armed',
  'incident_pending',
  'escalation_in_progress',
  'grace_period',
  'release_in_progress',
]);
const RELEASE_ACTIVE_STATES = new Set(['grace_period', 'release_in_progress']);
const WARNING_STATES = new Set(['incident_pending', 'escalation_in_progress']);

type BundleRecipient = {
  id: string;
  recipientKind: 'email' | 'sms' | 'secure_link' | 'social_handle';
  address: string;
  displayName?: string | null;
};

type Bundle = {
  id: string;
  title: string;
  releaseStage: 'on_release' | 'on_incident_open';
  visibility: 'private' | 'public';
  recipients: BundleRecipient[];
};

type Attachment = {
  id: string;
  blobRef: string;
  ciphertextHash: string;
  sizeBytes: number;
  mimeType: string;
  encryptionMode: string;
  createdAt: string;
  filename?: string;
  displayFilename?: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ScenarioDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { scenarios, load, arm, checkin, disarm, deleteDraft } = useScenarios();
  const serverNextDue = useScenarios((s) => (id ? s.nextDueByScenario[id] : undefined));

  const [mode, setMode] = useState<Mode>(null);
  /** 0-based step index inside the active multi-step sheet. */
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [working, setWorking] = useState(false);
  const [abortCode, setAbortCode] = useState<string | null>(null);
  const [showAbort, setShowAbort] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [bundlesLoading, setBundlesLoading] = useState(true);
  const [attachmentsByBundle, setAttachmentsByBundle] = useState<Record<string, Attachment[]>>({});

  /** Transient feedback banner — shown for 6s after arm/disarm/abort. */
  const [feedback, setFeedback] = useState<null | { kind: StateKind; eyebrow: string; message: string }>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashFeedback = useCallback(
    (next: { kind: StateKind; eyebrow: string; message: string }) => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      setFeedback(next);
      feedbackTimer.current = setTimeout(() => setFeedback(null), 6000);
    },
    [],
  );

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  const loadBundles = useCallback(async () => {
    if (!id) return;
    setBundlesLoading(true);
    try {
      const list = await api.get<Bundle[]>(`/scenarios/${id}/bundles`);
      setBundles(list);
      const perBundle = await Promise.all(
        list.map((b) =>
          api
            .get<Attachment[]>(`/bundles/${b.id}/attachments`)
            .then((atts) => [b.id, atts] as const)
            .catch(() => [b.id, [] as Attachment[]] as const),
        ),
      );
      setAttachmentsByBundle(Object.fromEntries(perBundle));
    } catch {
      // Stale list is preserved; an error banner here adds noise on a screen
      // that already has a lot of authoritative state to communicate.
    } finally {
      setBundlesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    void loadBundles();
  }, [load, loadBundles]);

  const scenario = useMemo(() => scenarios.find((s) => s.id === id), [scenarios, id]);

  if (!scenario) {
    return (
      <Screen title="Loading">
        <BodyMuted>Fetching scenario…</BodyMuted>
      </Screen>
    );
  }

  const isActive = ACTIVE_STATES.has(scenario.state);
  const isReleaseActive = RELEASE_ACTIVE_STATES.has(scenario.state);
  const isWarning = WARNING_STATES.has(scenario.state);
  const isDraft = scenario.state === 'draft';
  const isTerminal =
    scenario.state === 'released' || scenario.state === 'aborted' || scenario.state === 'expired';
  const nextCheckIn =
    serverNextDue ??
    (scenario.armedAt && scenario.checkinIntervalSeconds
      ? computeNextCheckin(scenario.armedAt, scenario.checkinIntervalSeconds)
      : undefined);

  function openArm() {
    setStep(0);
    setPassword('');
    setConfirmPhrase('');
    setMode('arm');
  }
  function openAbort() {
    setStep(0);
    setPassword('');
    setConfirmPhrase('');
    setMode('abort');
  }
  function closeMode() {
    if (working) return;
    setMode(null);
    setStep(0);
  }

  const abortPhrase = isReleaseActive ? 'ABORT' : 'DISARM';
  const abortVerb = isReleaseActive ? 'Abort release' : 'Disarm scenario';
  const abortConsequence = isReleaseActive
    ? 'Stops the in-progress release. Recipients who have not yet been delivered to will not receive anything. Already-delivered messages cannot be recalled.'
    : 'Stops monitoring this scenario and cancels any pending escalation. The scenario returns to draft and you may re-arm later.';

  async function doArm() {
    if (confirmPhrase.trim().toUpperCase() !== 'ARM') {
      Alert.alert('Confirmation required', 'Type ARM to confirm you understand.');
      return;
    }
    if (!password) {
      Alert.alert('Password required', 'Re-enter your account password.');
      return;
    }
    setWorking(true);
    try {
      await requireBiometric('Arm scenario');
      const { abortCode: code } = await arm(scenario!.id, password);
      setMode(null);
      setStep(0);
      setAbortCode(code);
      setShowAbort(true);
      flashFeedback({
        kind: 'safe',
        eyebrow: 'ARMED',
        message: 'Monitoring is live. Missing a check-in will start escalation.',
      });
    } catch (e) {
      Alert.alert('Arm failed', (e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function doAbort() {
    if (confirmPhrase.trim().toUpperCase() !== abortPhrase) {
      Alert.alert('Confirmation required', `Type ${abortPhrase} to confirm.`);
      return;
    }
    if (!password) {
      Alert.alert('Password required', 'Re-enter your account password.');
      return;
    }
    setWorking(true);
    try {
      await requireBiometric(abortVerb);
      await disarm(scenario!.id, password);
      setMode(null);
      setStep(0);
      flashFeedback({
        kind: isReleaseActive ? 'danger' : 'info',
        eyebrow: isReleaseActive ? 'RELEASE ABORTED' : 'DISARMED',
        message: isReleaseActive
          ? 'All pending release actions stopped. Audit trail retained.'
          : 'Monitoring stopped. The scenario is back in draft.',
      });
    } catch (e) {
      Alert.alert(`${abortVerb} failed`, (e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function doCheckIn() {
    try {
      await checkin(scenario!.id);
      flashFeedback({
        kind: 'safe',
        eyebrow: 'CHECKED IN',
        message: 'Next window scheduled. Escalation timer reset.',
      });
    } catch (e) {
      Alert.alert('Check-in failed', (e as Error).message);
    }
  }

  async function doDeleteDraft() {
    if (!scenario) return;
    setDeleting(true);
    try {
      await deleteDraft(scenario.id);
      setConfirmDelete(false);
      router.replace('/(app)/scenarios');
    } catch (e) {
      setConfirmDelete(false);
      Alert.alert('Delete failed', (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen
      eyebrow="Scenario"
      title={scenario.name}
      subtitle="This document describes when, how, and to whom the payload will be released."
    >
      {feedback ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Banner kind={feedback.kind} eyebrow={feedback.eyebrow} message={feedback.message} />
        </View>
      ) : null}

      {isReleaseActive ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Banner
            kind="danger"
            eyebrow={scenario.state === 'release_in_progress' ? 'RELEASE IN PROGRESS' : 'GRACE PERIOD'}
            message={
              scenario.state === 'release_in_progress'
                ? 'The payload is being delivered to recipients now. You can still abort to halt remaining sends.'
                : 'You are in the abort window. If you do nothing, the release will fire when this period ends.'
            }
          />
        </View>
      ) : isWarning ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Banner
            kind="warning"
            eyebrow="ATTENTION"
            message="A check-in was missed. Check in now to halt escalation."
          />
        </View>
      ) : null}

      {/* Status card */}
      <Card>
        <View style={styles.statusHeader}>
          <View style={{ flex: 1 }}>
            <Label>Current state</Label>
            <View style={{ height: spacing.xs }} />
            <StatusPill state={scenario.state} />
          </View>
          {isActive ? (
            <Pressable
              onPress={doCheckIn}
              style={({ pressed }) => [styles.checkInPill, pressed && { opacity: 0.8 }]}
            >
              <Label style={{ color: colors.textInverse, letterSpacing: 1.2 }}>Check in</Label>
            </Pressable>
          ) : null}
        </View>
        <CardDivider />
        <KeyValueRow>
          <View style={{ flex: 1 }}>
            <KeyValue
              label="Check-in cadence"
              value={formatDuration(scenario.checkinIntervalSeconds)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <KeyValue
              label="Grace period"
              value={formatDuration(scenario.gracePeriodSeconds)}
            />
          </View>
        </KeyValueRow>
        {isActive ? (
          <KeyValue
            label="Next check-in"
            value={`${relativeFromNow(nextCheckIn)} · ${formatDateTime(nextCheckIn)}`}
          />
        ) : null}
        {scenario.armedAt ? (
          <KeyValue label="Armed" value={formatDateTime(scenario.armedAt)} />
        ) : null}
        {scenario.releasedAt ? (
          <KeyValue label="Released" value={formatDateTime(scenario.releasedAt)} />
        ) : null}
      </Card>

      {/* Conditions */}
      <Section eyebrow="Conditions" hint="The system will begin escalation when any of the following is true.">
        <Card>
          <ConditionRow
            index="1"
            body={`You miss a scheduled check-in window of ${formatDuration(scenario.checkinIntervalSeconds)}.`}
          />
          <CardDivider />
          <ConditionRow
            index="2"
            body={`You do not resolve escalation within the grace period of ${formatDuration(scenario.gracePeriodSeconds)}.`}
          />
        </Card>
      </Section>

      {/* Escalation */}
      <Section eyebrow="Escalation" hint="What happens once a condition is triggered.">
        <Card>
          <EscalationStep
            ordinal="I"
            title="Incident opened"
            body="A missed check-in opens an incident. You receive priority alerts and can still check in to close it without penalty."
          />
          <CardDivider />
          <EscalationStep
            ordinal="II"
            title="Trusted contacts alerted"
            body="Your trusted contacts are notified that an incident is active. Those allowed may request a pause."
          />
          <CardDivider />
          <EscalationStep
            ordinal="III"
            title="Grace period"
            body={`The ${formatDuration(scenario.gracePeriodSeconds)} grace period begins. You — or you plus biometrics — are required to abort.`}
          />
          <CardDivider />
          <EscalationStep
            ordinal="IV"
            title="Release"
            body="If the scenario is not resolved, the payload is released to recipients exactly as configured."
          />
        </Card>
      </Section>

      {/* Release preview — link out to the dedicated screen */}
      <Section
        eyebrow="Release preview"
        hint="Open the focused preview to see exactly what each recipient will receive."
      >
        <Card>
          <KeyValueRow>
            <View style={{ flex: 1 }}>
              <KeyValue
                label="Recipients"
                value={String(bundles.reduce((n, b) => n + b.recipients.length, 0))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <KeyValue
                label="Attachments"
                value={String(
                  Object.values(attachmentsByBundle).reduce((sum, a) => sum + a.length, 0),
                )}
              />
            </View>
          </KeyValueRow>
          {bundlesLoading && bundles.length === 0 ? (
            <BodyMuted>Loading…</BodyMuted>
          ) : (
            <View style={{ marginTop: spacing.xs }}>
              {bundles.flatMap((b) =>
                b.recipients.slice(0, 3).map((r) => (
                  <MetaRow
                    key={r.id}
                    kind={r.recipientKind === 'social_handle' ? 'SOCIAL' : r.recipientKind}
                    title={r.displayName ?? r.address}
                    meta={r.displayName ? r.address : undefined}
                  />
                )),
              )}
              {(() => {
                const total = bundles.reduce((n, b) => n + b.recipients.length, 0);
                return total > 3 ? (
                  <Small style={{ color: colors.textMuted, marginTop: spacing.xs }}>
                    + {total - 3} more recipient{total - 3 === 1 ? '' : 's'}
                  </Small>
                ) : null;
              })()}
            </View>
          )}
          <View style={{ height: spacing.md }} />
          <Button
            title="Open release preview"
            variant="secondary"
            onPress={() => router.push(`/(app)/scenarios/${scenario.id}/preview`)}
          />
        </Card>
      </Section>

      {/* Quick attachment summary inline (kept compact; full per-recipient preview lives on /preview) */}
      {(() => {
        const totalAttachments = Object.values(attachmentsByBundle).reduce(
          (sum, a) => sum + a.length,
          0,
        );
        if (totalAttachments === 0) return null;
        return (
          <Section eyebrow="Attached files" hint="Delivered as one-time secure links per recipient.">
            <Card>
              {bundles.flatMap((b) =>
                (attachmentsByBundle[b.id] ?? []).map((a) => (
                  <MetaRow
                    key={a.id}
                    kind="FILE"
                    title={a.displayFilename ?? a.filename ?? a.blobRef}
                    meta={`${formatBytes(a.sizeBytes)} · ${a.mimeType}`}
                  />
                )),
              )}
            </Card>
          </Section>
        );
      })()}

      {/* Terminal or actionable block */}
      {isTerminal ? (
        <Card tone="raised">
          <Label>This scenario is closed</Label>
          <View style={{ height: spacing.xs }} />
          <BodyMuted>
            {scenario.state === 'released'
              ? 'Payload has been released. This record is kept for your audit trail.'
              : scenario.state === 'aborted'
              ? 'A release was aborted. The scenario has been retired.'
              : 'This scenario expired without release.'}
          </BodyMuted>
          <View style={{ height: spacing.md }} />
          <Button title="Back to scenarios" variant="secondary" onPress={() => router.back()} />
        </Card>
      ) : (
        <Section
          eyebrow={isDraft ? 'Arm scenario' : abortVerb}
          hint={
            isDraft
              ? 'Arming binds this scenario to your key. A missed check-in will begin escalation.'
              : abortConsequence
          }
        >
          {isDraft ? (
            <>
              <Button title="Arm scenario" onPress={openArm} />
              <View style={{ height: spacing.sm }} />
              <Button
                title="Delete draft"
                variant="destructive"
                onPress={() => setConfirmDelete(true)}
              />
            </>
          ) : (
            <Button title={abortVerb} variant="destructive" onPress={openAbort} />
          )}
        </Section>
      )}

      {/* Arm flow — two steps */}
      <Sheet visible={mode === 'arm'} onClose={closeMode}>
        <Stepper steps={['Consequences', 'Authenticate']} current={step} />
        <View style={{ height: spacing.lg }} />
        {step === 0 ? (
          <ArmStepConsequences
            scenarioName={scenario.name}
            checkin={formatDuration(scenario.checkinIntervalSeconds)}
            grace={formatDuration(scenario.gracePeriodSeconds)}
            onCancel={closeMode}
            onContinue={() => setStep(1)}
            disabled={working}
          />
        ) : (
          <ArmStepAuthenticate
            password={password}
            onPasswordChange={setPassword}
            confirmPhrase={confirmPhrase}
            onConfirmChange={setConfirmPhrase}
            onBack={() => (working ? null : setStep(0))}
            onConfirm={doArm}
            working={working}
          />
        )}
      </Sheet>

      {/* Abort flow — two steps, state-aware copy */}
      <Sheet visible={mode === 'abort'} onClose={closeMode}>
        <Stepper steps={['Consequences', 'Authenticate']} current={step} />
        <View style={{ height: spacing.lg }} />
        {step === 0 ? (
          <AbortStepConsequences
            verb={abortVerb}
            consequence={abortConsequence}
            isReleaseActive={isReleaseActive}
            onCancel={closeMode}
            onContinue={() => setStep(1)}
          />
        ) : (
          <AbortStepAuthenticate
            verb={abortVerb}
            phrase={abortPhrase}
            password={password}
            onPasswordChange={setPassword}
            confirmPhrase={confirmPhrase}
            onConfirmChange={setConfirmPhrase}
            onBack={() => (working ? null : setStep(0))}
            onConfirm={doAbort}
            working={working}
            destructive
          />
        )}
      </Sheet>

      {/* Abort code — shown once */}
      <ConfirmDialog
        visible={showAbort && !!abortCode}
        eyebrow="Abort code · shown only once"
        title="Save this code somewhere safe"
        message={
          <View>
            <BodyMuted style={{ marginBottom: spacing.md }}>
              This code lets you abort a release even if you cannot sign in. We cannot show it again.
            </BodyMuted>
            <View style={styles.codeBlock}>
              <Mono selectable>{abortCode ?? ''}</Mono>
            </View>
            <MonoSmall style={{ marginTop: spacing.sm }}>
              Treat this like a recovery key. Do not screenshot unsafely.
            </MonoSmall>
          </View>
        }
        confirmLabel="I saved it"
        cancelLabel="Not yet"
        onCancel={() => setShowAbort(false)}
        onConfirm={() => {
          setShowAbort(false);
          setAbortCode(null);
        }}
      />

      {/* Delete draft confirmation */}
      <ConfirmDialog
        visible={confirmDelete}
        eyebrow="Delete draft"
        title={`Delete "${scenario.name}"?`}
        message="The scenario, its recipients, message, and any attached files will be permanently removed. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        loading={deleting}
        onCancel={() => (deleting ? undefined : setConfirmDelete(false))}
        onConfirm={doDeleteDraft}
      />
    </Screen>
  );
}

function ArmStepConsequences({
  scenarioName,
  checkin,
  grace,
  onCancel,
  onContinue,
  disabled,
}: {
  scenarioName: string;
  checkin: string;
  grace: string;
  onCancel: () => void;
  onContinue: () => void;
  disabled: boolean;
}) {
  return (
    <View>
      <Label>Step 1 of 2 · Read carefully</Label>
      <Heading style={{ marginTop: spacing.xs }}>Arm &ldquo;{scenarioName}&rdquo;?</Heading>
      <View style={{ height: spacing.md }} />
      <BodyMuted>
        Once armed, the system begins enforcing the contract on this scenario. You must check in
        every {checkin}. If you miss a check-in, an incident opens and a {grace} grace period begins
        — after which the payload will be released exactly as previewed.
      </BodyMuted>
      <View style={{ height: spacing.md }} />
      <View style={styles.consequenceList}>
        <ConsequenceLine text="You will be required to check in regularly." />
        <ConsequenceLine text="Trusted contacts may be alerted during escalation." />
        <ConsequenceLine text="Release is irreversible once delivered." />
      </View>
      <View style={{ height: spacing.xl }} />
      <View style={styles.modalRow}>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={disabled} />
        </View>
        <View style={{ width: spacing.sm }} />
        <View style={{ flex: 1 }}>
          <Button title="I understand" onPress={onContinue} disabled={disabled} />
        </View>
      </View>
    </View>
  );
}

function ArmStepAuthenticate({
  password,
  onPasswordChange,
  confirmPhrase,
  onConfirmChange,
  onBack,
  onConfirm,
  working,
}: {
  password: string;
  onPasswordChange: (v: string) => void;
  confirmPhrase: string;
  onConfirmChange: (v: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  working: boolean;
}) {
  return (
    <View>
      <Label>Step 2 of 2 · Authenticate</Label>
      <Heading style={{ marginTop: spacing.xs }}>Confirm to arm</Heading>
      <View style={{ height: spacing.md }} />
      <BodyMuted>
        Re-enter your password and type ARM to bind this scenario to your key. Biometrics will be
        requested on confirm.
      </BodyMuted>
      <View style={{ height: spacing.lg }} />
      <Field
        label="Password"
        placeholder="Re-enter account password"
        value={password}
        onChangeText={onPasswordChange}
        secureTextEntry
      />
      <View style={{ height: spacing.md }} />
      <Field
        label="Type ARM to confirm"
        placeholder="ARM"
        value={confirmPhrase}
        onChangeText={onConfirmChange}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <View style={{ height: spacing.xl }} />
      <View style={styles.modalRow}>
        <View style={{ flex: 1 }}>
          <Button title="Back" variant="secondary" onPress={onBack} disabled={working} />
        </View>
        <View style={{ width: spacing.sm }} />
        <View style={{ flex: 1 }}>
          <Button title="Arm now" onPress={onConfirm} loading={working} />
        </View>
      </View>
    </View>
  );
}

function AbortStepConsequences({
  verb,
  consequence,
  isReleaseActive,
  onCancel,
  onContinue,
}: {
  verb: string;
  consequence: string;
  isReleaseActive: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <View>
      <Label>Step 1 of 2 · Read carefully</Label>
      <Heading style={{ marginTop: spacing.xs }}>{verb}?</Heading>
      <View style={{ height: spacing.md }} />
      <BodyMuted>{consequence}</BodyMuted>
      <View style={{ height: spacing.md }} />
      <View style={styles.consequenceList}>
        <ConsequenceLine
          text={
            isReleaseActive
              ? 'In-flight sends already accepted by providers cannot be recalled.'
              : 'You may re-arm later from the same scenario.'
          }
        />
        <ConsequenceLine text="A full audit record is retained either way." />
      </View>
      <View style={{ height: spacing.xl }} />
      <View style={styles.modalRow}>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
        <View style={{ width: spacing.sm }} />
        <View style={{ flex: 1 }}>
          <Button title="I understand" variant="destructive" onPress={onContinue} />
        </View>
      </View>
    </View>
  );
}

function AbortStepAuthenticate({
  verb,
  phrase,
  password,
  onPasswordChange,
  confirmPhrase,
  onConfirmChange,
  onBack,
  onConfirm,
  working,
  destructive,
}: {
  verb: string;
  phrase: string;
  password: string;
  onPasswordChange: (v: string) => void;
  confirmPhrase: string;
  onConfirmChange: (v: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  working: boolean;
  destructive: boolean;
}) {
  return (
    <View>
      <Label>Step 2 of 2 · Authenticate</Label>
      <Heading style={{ marginTop: spacing.xs }}>Confirm to {verb.toLowerCase()}</Heading>
      <View style={{ height: spacing.md }} />
      <BodyMuted>
        Re-enter your password and type {phrase} to confirm. Biometrics will be requested on confirm.
      </BodyMuted>
      <View style={{ height: spacing.lg }} />
      <Field
        label="Password"
        placeholder="Re-enter account password"
        value={password}
        onChangeText={onPasswordChange}
        secureTextEntry
      />
      <View style={{ height: spacing.md }} />
      <Field
        label={`Type ${phrase} to confirm`}
        placeholder={phrase}
        value={confirmPhrase}
        onChangeText={onConfirmChange}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <View style={{ height: spacing.xl }} />
      <View style={styles.modalRow}>
        <View style={{ flex: 1 }}>
          <Button title="Back" variant="secondary" onPress={onBack} disabled={working} />
        </View>
        <View style={{ width: spacing.sm }} />
        <View style={{ flex: 1 }}>
          <Button
            title={verb}
            variant={destructive ? 'destructive' : 'primary'}
            onPress={onConfirm}
            loading={working}
          />
        </View>
      </View>
    </View>
  );
}

function ConsequenceLine({ text }: { text: string }) {
  return (
    <View style={styles.consequenceLine}>
      <View style={styles.consequenceBullet} />
      <Body style={{ flex: 1 }}>{text}</Body>
    </View>
  );
}

function ConditionRow({ index, body }: { index: string; body: string }) {
  return (
    <View style={styles.condRow}>
      <View style={styles.condIndex}>
        <Mono style={{ color: colors.textMuted }}>{index}</Mono>
      </View>
      <Body style={{ flex: 1 }}>{body}</Body>
    </View>
  );
}

function EscalationStep({
  ordinal,
  title,
  body,
}: {
  ordinal: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepOrdinal}>
        <MonoSmall style={{ color: colors.textMuted }}>{ordinal}</MonoSmall>
      </View>
      <View style={{ flex: 1 }}>
        <Heading style={{ fontSize: 16, lineHeight: 22 }}>{title}</Heading>
        <View style={{ height: 2 }} />
        <Small>{body}</Small>
      </View>
    </View>
  );
}

function computeNextCheckin(armedAt?: string, intervalSeconds?: number): string | undefined {
  if (!armedAt || !intervalSeconds) return undefined;
  try {
    const start = new Date(armedAt).getTime();
    const now = Date.now();
    if (Number.isNaN(start)) return undefined;
    const elapsed = Math.max(0, now - start);
    const passed = Math.floor(elapsed / (intervalSeconds * 1000));
    return new Date(start + (passed + 1) * intervalSeconds * 1000).toISOString();
  } catch {
    return undefined;
  }
}

const styles = StyleSheet.create({
  statusHeader: { flexDirection: 'row', alignItems: 'center' },
  checkInPill: {
    backgroundColor: colors.text,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  condRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  condIndex: { width: 24, alignItems: 'flex-start' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepOrdinal: {
    width: 28,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    paddingTop: 4,
  },
  consequenceList: { gap: spacing.xs },
  consequenceLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  consequenceBullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    marginTop: 9,
  },
  modalRow: { flexDirection: 'row', alignItems: 'center' },
  codeBlock: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    padding: spacing.md,
  },
});
