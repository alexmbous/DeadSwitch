import { useCallback, useEffect, useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScenarios } from '@/scenarios/state';
import {
  Body,
  BodyMuted,
  Button,
  Card,
  Display,
  Heading,
  Label,
  Small,
  StatusPill,
  colors,
  formatDuration,
  spacing,
} from '@/ui';

export default function ScenariosList() {
  const { scenarios, load, loading } = useScenarios();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => void load(), [load]);

  const sorted = useMemo(() => {
    // Sort: attention-first (danger > warning > safe > info/terminal), then by name.
    const rank: Record<string, number> = {
      release_in_progress: 0,
      grace_period: 1,
      escalation_in_progress: 2,
      incident_pending: 3,
      armed: 4,
      draft: 5,
      aborted: 6,
      released: 7,
      expired: 8,
    };
    return [...scenarios].sort((a, b) => {
      const ra = rank[a.state] ?? 9;
      const rb = rank[b.state] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [scenarios]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <FlatList
        data={sorted}
        keyExtractor={(s) => s.id}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: spacing.xxxl + insets.bottom },
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.textMuted} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Label>Scenarios</Label>
            <Display style={{ marginTop: spacing.xs }}>
              {scenarios.length === 0 ? 'Nothing yet' : `${scenarios.length} total`}
            </Display>
            <BodyMuted style={{ marginTop: spacing.sm }}>
              Every scenario defines the conditions under which its payload will be released.
            </BodyMuted>
            <View style={{ height: spacing.lg }} />
            <Button
              title="New scenario"
              onPress={() => router.push('/(app)/scenarios/new')}
            />
            <View style={styles.divider} />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(app)/scenarios/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
          >
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Heading numberOfLines={1}>{item.name}</Heading>
              <Small style={{ marginTop: 2 }}>
                Check-in every {formatDuration(item.checkinIntervalSeconds)} · grace{' '}
                {formatDuration(item.gracePeriodSeconds)}
              </Small>
            </View>
            <StatusPill state={item.state} size="sm" />
          </Pressable>
        )}
        ListEmptyComponent={
          !loading ? (
            <Card>
              <Body color="textMuted">
                No scenarios yet. Create one to configure conditions, escalation, and recipients.
              </Body>
            </Card>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xl,
  },
  header: { marginBottom: spacing.md },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
});
