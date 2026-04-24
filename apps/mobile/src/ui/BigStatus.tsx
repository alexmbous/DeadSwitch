import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, kindToColor, radii, spacing, StateKind, typography } from './theme';
import { Label, Text } from './Text';

interface Props {
  /** Semantic state — drives ring color. */
  kind: StateKind;
  /** Short status word, e.g. "ARMED" or "GRACE PERIOD". Always uppercased. */
  state: string;
  /** Optional second line under the state — short context, e.g. "3 scenarios". */
  detail?: string;
  /** Compact variant for non-dashboard surfaces. */
  size?: 'lg' | 'md';
  style?: ViewStyle;
}

/**
 * Dashboard-grade status indicator. Concentric ring + dot, with the state
 * word stacked beneath. Color comes from the semantic palette so it reads
 * the same as `StatusPill` and `Card tone`.
 *
 * Used on the dashboard above the live countdown. There is exactly one of
 * these per screen.
 */
export function BigStatus({ kind, state, detail, size = 'lg', style }: Props) {
  const palette = kindToColor(kind);
  const ringSize = size === 'lg' ? 132 : 96;
  const innerSize = size === 'lg' ? 92 : 64;
  const dotSize = size === 'lg' ? 28 : 20;

  return (
    <View style={[styles.wrap, style]}>
      <View
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderColor: palette.border,
            backgroundColor: palette.bg,
          },
        ]}
      >
        <View
          style={[
            styles.inner,
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerSize / 2,
              borderColor: palette.border,
            },
          ]}
        >
          <View
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: palette.fg,
            }}
          />
        </View>
      </View>

      <View style={{ height: spacing.lg }} />
      <Label style={[styles.label, { color: palette.fg }]}>{state}</Label>
      {detail ? (
        <Text
          style={[typography.bodyMuted, styles.detail]}
          numberOfLines={2}
          accessibilityLabel={detail}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  ring: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  label: {
    fontSize: 13,
    letterSpacing: 2.5,
    textAlign: 'center',
  },
  detail: {
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
// `radii` import retained for future variants; intentionally unused for now.
void radii;
