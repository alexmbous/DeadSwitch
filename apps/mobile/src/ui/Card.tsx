import { ReactNode } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radii, spacing } from './theme';
import { Label } from './Text';

interface CardProps {
  children: ReactNode;
  title?: string;
  style?: ViewStyle;
  tone?: 'default' | 'raised' | 'danger' | 'warning';
  onPress?: () => void;
}

export function Card({ children, title, style, tone = 'default', onPress }: CardProps) {
  const toneStyle = toneStyles[tone];
  const body = (
    <View style={[styles.card, toneStyle, style]}>
      {title ? <Label style={{ marginBottom: spacing.md }}>{title}</Label> : null}
      {children}
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

/** A horizontal divider used inside cards to separate sections. */
export function CardDivider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
});

const toneStyles = StyleSheet.create({
  default: {},
  raised: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
  },
  danger: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  warning: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
});
