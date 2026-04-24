import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { spacing } from './theme';
import { Label, BodyMuted } from './Text';

interface Props {
  eyebrow?: string;
  hint?: string;
  children: ReactNode;
  style?: ViewStyle;
}

/** A titled section. Eyebrow is uppercase label; hint is the optional explanatory line. */
export function Section({ eyebrow, hint, children, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      {eyebrow ? <Label style={styles.eyebrow}>{eyebrow}</Label> : null}
      {hint ? <BodyMuted style={styles.hint}>{hint}</BodyMuted> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xl },
  eyebrow: { marginBottom: spacing.sm },
  hint: { marginBottom: spacing.md },
});
