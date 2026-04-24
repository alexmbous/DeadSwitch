import { ReactNode } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, kindToColor, radii, spacing, StateKind } from './theme';
import { Body, Label } from './Text';

interface Props {
  kind: StateKind;
  /** Eyebrow line — uppercase short tag, e.g. "RELEASE ABORTED". */
  eyebrow?: string;
  /** One-sentence body. */
  message: ReactNode;
  /** Optional action label; when present, banner is tappable. */
  actionLabel?: string;
  onPress?: () => void;
  style?: ViewStyle;
}

/**
 * State banner for prominent system-level feedback. Used on the dashboard
 * during release-in-progress / grace, and on the scenario detail page
 * after an abort succeeds. Always full-width inside its container.
 *
 * Banners are stronger than `Card tone="warning"` because they sit at the
 * very top of a screen and recolor the user's attention immediately.
 */
export function Banner({ kind, eyebrow, message, actionLabel, onPress, style }: Props) {
  const palette = kindToColor(kind);
  const body = (
    <View
      style={[
        styles.wrap,
        { backgroundColor: palette.bg, borderColor: palette.border },
        style,
      ]}
    >
      <View style={[styles.bar, { backgroundColor: palette.fg }]} />
      <View style={styles.content}>
        {eyebrow ? (
          <Label style={[styles.eyebrow, { color: palette.fg }]}>{eyebrow}</Label>
        ) : null}
        {typeof message === 'string' ? <Body>{message}</Body> : message}
        {actionLabel ? (
          <View style={{ marginTop: spacing.xs }}>
            <Label style={{ color: palette.fg }}>{actionLabel} →</Label>
          </View>
        ) : null}
      </View>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} android_ripple={{ color: colors.surfaceRaised }}>
        {body}
      </Pressable>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: radii.lg,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  bar: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: spacing.md,
    gap: 0,
  },
  eyebrow: {
    marginBottom: spacing.xxs,
  },
});
