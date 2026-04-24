import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, spacing } from './theme';
import { Body, Mono, Small } from './Text';

interface Props {
  /** Short uppercase tag in monospace, e.g. "EMAIL" / "FILE" / "SMS". */
  kind: string;
  /** Primary line — usually a name or filename. */
  title: string;
  /** Secondary line — meta like "12 KB · application/pdf · expires in 4h". */
  meta?: string;
  /** Optional trailing slot (button, icon). */
  trailing?: ReactNode;
  style?: ViewStyle;
}

/**
 * Document-style row for recipients, attachments, and similar lists. The
 * mono kind tag on the left makes the row scan like a manifest entry —
 * which is the feel we want on the Release Preview screen.
 */
export function MetaRow({ kind, title, meta, trailing, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <Mono style={styles.kind}>{kind.toUpperCase()}</Mono>
      <View style={styles.body}>
        <Body numberOfLines={1}>{title}</Body>
        {meta ? <Small style={{ marginTop: 2, color: colors.textMuted }}>{meta}</Small> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  kind: {
    width: 56,
    color: colors.textMuted,
  },
  body: {
    flex: 1,
  },
  trailing: {
    marginLeft: spacing.sm,
  },
});
