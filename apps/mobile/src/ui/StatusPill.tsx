import { StyleSheet, View } from 'react-native';
import { colors, kindToColor, radii, scenarioStateKind, scenarioStateLabel, spacing, typography } from './theme';
import { Text } from './Text';

interface Props {
  state: string;
  size?: 'sm' | 'md';
}

export function StatusPill({ state, size = 'md' }: Props) {
  const kind = scenarioStateKind[state] ?? 'info';
  const label = scenarioStateLabel[state] ?? state;
  const palette = kindToColor(kind);
  return (
    <View
      style={[
        styles.pill,
        size === 'sm' ? styles.sm : styles.md,
        { borderColor: palette.border, backgroundColor: palette.bg },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: palette.fg }]} />
      <Text
        style={[
          typography.label,
          size === 'sm' && { fontSize: 10, letterSpacing: 1.4 },
          { color: palette.fg },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  sm: { paddingVertical: 3 },
  md: { paddingVertical: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
