import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from './theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  fullWidth = true,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const v = variantStyles[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        v.container,
        pressed && !isDisabled && v.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.labelColor} />
      ) : (
        <Text
          style={[
            typography.subheading,
            { color: v.labelColor, letterSpacing: 0.3, textAlign: 'center' },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Two buttons side-by-side — cancel + action. */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', gap: spacing.sm },
});

const variantStyles: Record<
  Variant,
  { container: ViewStyle; pressed: ViewStyle; labelColor: string }
> = {
  primary: {
    container: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    pressed: { backgroundColor: '#C8CBCF' },
    labelColor: colors.textInverse,
  },
  secondary: {
    container: {
      backgroundColor: 'transparent',
      borderColor: colors.borderStrong,
    },
    pressed: { backgroundColor: colors.surface },
    labelColor: colors.text,
  },
  destructive: {
    container: {
      backgroundColor: 'transparent',
      borderColor: colors.danger,
    },
    pressed: { backgroundColor: colors.dangerSoft },
    labelColor: colors.danger,
  },
  ghost: {
    container: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      minHeight: 44,
    },
    pressed: { backgroundColor: colors.surface },
    labelColor: colors.textMuted,
  },
};
