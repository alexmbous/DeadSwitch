import { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing, typography } from './theme';
import { Label, Small } from './Text';

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function Field({ label, hint, error, containerStyle, style, onFocus, onBlur, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Label style={{ marginBottom: spacing.xs }}>{label}</Label> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          style,
        ]}
      />
      {error ? (
        <Small style={{ color: colors.danger, marginTop: spacing.xs }}>{error}</Small>
      ) : hint ? (
        <Small style={{ marginTop: spacing.xs }}>{hint}</Small>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    minHeight: 48,
  },
  inputFocused: {
    borderColor: colors.focus,
    backgroundColor: colors.surfaceAlt,
  },
  inputError: {
    borderColor: colors.danger,
  },
});
