import { useCallback, useEffect, useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Scenario, useScenarios } from '@/scenarios/state';
import {
  Banner,
  BigStatus,
  Body,
  BodyMuted,
  Button,
  Countdown,
  Label,
  Small,
  StateKind,
  colors,
  formatDateTime,
  scenarioStateLabel,
  spacing,
} from '@/ui';

const ATTENTION_RANK: Record<string, number> = {
  release_in_progress: 0,
  grace_period: 1,
  escalation_in_progress: 2,
  incident_pending: 3,
  armed: 4,
  draft: 5,
};

const ARMED_STATES = new Set([
  'armed',
  'incident_pending',
  'escalation_in_progress',
  'grace_period',
  'release_in_progress',
]);

const DANGER_STATES = new Set(['grace_period', 'release_in_progress']);
const WARNING_STATES = new Set(['incident_pending', 'escalation_in_progress']);

/**
 * Single-focal dashboard.
 *
 * One large state ring + one live countdown + one primary action. Everything
 * else (per-scenario list) lives one tap away in the Scenarios tab. The user
 * must always be able to answer: "Am I safe? When is the next event? What
 * single thing should I tap right now?" — without scrolling, without
 * reading any prose first.
 */
export default function Dashboard() {
  const { scenarios, load, loading, checkin } = useScenarios();
  const nextDueByScenario = useScenarios((s) => s.nextDueByScenario);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => void load(), [load]);

  const focused = useMemo(() => pickFocused(scenarios), [scenarios]);
  const counts = useMemo(() => {
    const armed = scenarios.filter((s) => ARMED_STATES.has(s.state)).length;
    const attention = scenarios.filter(
      (s) => DANGER_STATES.has(s.state) || WARNING_STATES.has(s.state),
    ).length;
    return { armed, attention, total: scenarios.length };
  }, [scenarios]);

  const overallKind: StateKind = focused
    ? DANGER_STATES.has(focused.state)
      ? 'danger'
      : WARNING_STATES.has(focused.state)
      ? 'warning'
      : 'safe'
    : counts.total === 0
    ? 'info'
    : 'info';

  const headlineState = focused
    ? scenarioStateLabel[focused.state]?.toUpperCase() ?? focused.state.toUpperCase()
    : counts.total === 0
    ? 'NO SCENARIOS'
    : 'NOTHING ARMED';

  const headlineDetail = focused
    ? focused.name
    : counts.total === 0
    ? 'Create one to begin.'
    : `${counts.total} scenario${counts.total === 1 ? '' : 's'} · all draft`;

  const next = focused ? nextEventFor(focused, nextDueByScenario[focused.id]) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxxl + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.textMuted} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Label>DeadSwitch · Status</Label>

        {overallKind === 'danger' ? (
          <View style={{ marginTop: spacing.md }}>
            <Banner
              kind="danger"
              eyebrow={focused?.state === 'release_in_progress' ? 'RELEASE IN PROGRESS' : 'GRACE PERIOD'}
              message={
                focused?.state === 'release_in_progress'
                  ? 'A scenario is currently delivering its payload to recipients.'
                  : 'A scenario is in its grace period. The release will fire if not aborted.'
              }
              actionLabel="Open scenario"
              onPress={() => focused && router.push(`/(app)/scenarios/${focused.id}`)}
            />
          </View>
        ) : null}

        <View style={styles.statusBlock}>
          <BigStatus kind={overallKind} state={headlineState} detail={headlineDetail} />
        </View>

        <View style={styles.countdownBlock}>
          <Countdown
            label={next ? next.label : 'No upcoming event'}
            target={next?.target}
            caption={next?.caption}
            tone={overallKind === 'danger' ? 'danger' : overallKind === 'warning' ? 'warning' : 'muted'}
            align="center"
            size="lg"
          />
        </View>

        <View style={styles.primaryAction}>
          <PrimaryAction
            scenarios={scenarios}
            focused={focused}
            onCheckIn={(id) => checkin(id)}
          />
        </View>

        <View style={styles.footer}>
          <SummaryLine
            armed={counts.armed}
            attention={counts.attention}
            total={counts.total}
          />
          <View style={{ height: spacing.md }} />
          <Pressable
            onPress={() => router.push('/(app)/scenarios')}
            style={({ pressed }) => [styles.allLink, pressed && { opacity: 0.7 }]}
          >
            <Label style={{ color: colors.textMuted }}>All scenarios →</Label>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PrimaryAction({
  scenarios,
  focused,
  onCheckIn,
}: {
  scenarios: Scenario[];
  focused: Scenario | null;
  onCheckIn: (id: string) => void;
}) {
  if (!focused) {
    if (scenarios.length === 0) {
      return (
        <Button
          title="Create your first scenario"
          onPress={() => router.push('/(app)/scenarios/new')}
        />
      );
    }
    return (
      <Button
        title="Open scenarios"
        variant="secondary"
        onPress={() => router.push('/(app)/scenarios')}
      />
    );
  }

  // In dangerous states, the dashboard never offers a destructive action —
  // those live on the scenario detail page where the abort flow guards them.
  if (DANGER_STATES.has(focused.state)) {
    return (
      <Button
        title="Open scenario"
        variant="destructive"
        onPress={() => router.push(`/(app)/scenarios/${focused.id}`)}
      />
    );
  }

  if (WARNING_STATES.has(focused.state) || focused.state === 'armed') {
    return (
      <Button
        title="Check in now"
        onPress={() => onCheckIn(focused.id)}
      />
    );
  }

  return (
    <Button
      title="Open scenario"
      variant="secondary"
      onPress={() => router.push(`/(app)/scenarios/${focused.id}`)}
    />
  );
}

function SummaryLine({
  armed,
  attention,
  total,
}: {
  armed: number;
  attention: number;
  total: number;
}) {
  return (
    <View style={styles.summaryRow}>
      <SummaryStat value={armed} tone="safe" label="ARMED" />
      <SummaryDivider />
      <SummaryStat value={attention} tone={attention ? 'warning' : 'muted'} label="ATTENTION" />
      <SummaryDivider />
      <SummaryStat value={total} tone="muted" label="TOTAL" />
    </View>
  );
}

function SummaryStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: 'safe' | 'warning' | 'muted';
}) {
  const color =
    tone === 'safe' ? colors.safe : tone === 'warning' ? colors.warning : colors.textMuted;
  return (
    <View style={styles.summaryStat}>
      <Body style={{ color, fontWeight: '600', fontSize: 18, lineHeight: 22 }}>
        {String(value)}
      </Body>
      <Small style={{ color: colors.textMuted, letterSpacing: 1.4, marginTop: 2 }}>{label}</Small>
    </View>
  );
}

function SummaryDivider() {
  return <View style={styles.summaryDivider} />;
}

/**
 * The single scenario the dashboard centers on. Highest-attention scenario
 * wins; among ties, the one with the soonest next event.
 */
function pickFocused(scenarios: Scenario[]): Scenario | null {
  if (!scenarios || scenarios.length === 0) return null;
  const armed = scenarios.filter((s) => ARMED_STATES.has(s.state));
  if (armed.length === 0) return null;
  return [...armed].sort((a, b) => {
    const ra = ATTENTION_RANK[a.state] ?? 9;
    const rb = ATTENTION_RANK[b.state] ?? 9;
    if (ra !== rb) return ra - rb;
    const na = nextEventFor(a)?.target;
    const nb = nextEventFor(b)?.target;
    if (na && nb) return new Date(na).getTime() - new Date(nb).getTime();
    if (na) return -1;
    if (nb) return 1;
    return a.name.localeCompare(b.name);
  })[0];
}

function nextEventFor(
  s: Scenario,
  serverNextDue?: string,
): { label: string; target: string; caption?: string } | null {
  // For grace_period / release_in_progress we don't yet have a precise
  // server-provided deadline in the mobile model. Fall back to a generic
  // label so the dashboard still tells the truth about the state without
  // implying false precision.
  if (s.state === 'grace_period') {
    return {
      label: 'Grace period — abort window',
      target: undefined as unknown as string,
      caption: `Open ${s.name} to abort`,
    };
  }
  if (s.state === 'release_in_progress') {
    return {
      label: 'Release in progress',
      target: undefined as unknown as string,
      caption: `Delivering payload for ${s.name}`,
    };
  }
  if (s.state === 'incident_pending' || s.state === 'escalation_in_progress') {
    return {
      label: 'Escalating — check in to halt',
      target: undefined as unknown as string,
      caption: s.name,
    };
  }
  if (s.state === 'armed' && s.armedAt && s.checkinIntervalSeconds) {
    const next = serverNextDue ?? nextCheckin(s.armedAt, s.checkinIntervalSeconds);
    return {
      label: 'NEXT CHECK-IN',
      target: next,
      caption: `${s.name} · ${formatDateTime(next)}`,
    };
  }
  return null;
}

function nextCheckin(armedAt: string, intervalSeconds: number): string {
  const start = new Date(armedAt).getTime();
  const elapsed = Math.max(0, Date.now() - start);
  const passed = Math.floor(elapsed / (intervalSeconds * 1000));
  return new Date(start + (passed + 1) * intervalSeconds * 1000).toISOString();
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xl,
  },
  statusBlock: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  countdownBlock: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  primaryAction: {
    marginTop: spacing.xl,
  },
  footer: {
    marginTop: spacing.xxxl,
    paddingTop: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  summaryStat: { flex: 1, alignItems: 'center' },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  allLink: { alignSelf: 'center' },
});

// Suppress the unused-prop warning for BodyMuted; retained for future use.
void BodyMuted;
