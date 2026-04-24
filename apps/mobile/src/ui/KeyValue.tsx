import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { spacing } from './theme';
import { Body, Label } from './Text';

interface Props {
  label: string;
  value: string | ReactNode;
  style?: ViewStyle;
}

/** Document-style label/value pair. Label on top (uppercase, spaced), value below. */
export function KeyValue({ label, value, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <Label style={{ marginBottom: spacing.xxs }}>{label}</Label>
      {typeof value === 'string' ? <Body>{value}</Body> : value}
    </View>
  );
}

/** Two KeyValues sitting side-by-side. */
export function KeyValueRow({ children }: { children: ReactNode }) {
  return <View style={styles.inline}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { marginBottom: spacing.md },
  inline: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginBottom: spacing.md,
  },
});
