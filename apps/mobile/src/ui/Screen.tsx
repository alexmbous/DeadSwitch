import { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from './theme';
import { Display, Label, BodyMuted } from './Text';

interface ScreenProps {
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  footer?: ReactNode;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

export function Screen({
  title,
  eyebrow,
  subtitle,
  children,
  scroll = true,
  padded = true,
  footer,
  style,
  contentStyle,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const hasHeader = Boolean(title || eyebrow);

  const header = hasHeader ? (
    <View style={styles.headerBlock}>
      {eyebrow ? (
        <Label style={{ marginBottom: spacing.xs }}>{eyebrow}</Label>
      ) : null}
      {title ? <Display>{title}</Display> : null}
      {subtitle ? (
        <BodyMuted style={{ marginTop: spacing.xs }}>{subtitle}</BodyMuted>
      ) : null}
    </View>
  ) : null;

  const inner = (
    <>
      {header}
      <View style={contentStyle}>{children}</View>
    </>
  );

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[
        padded && styles.paddedContent,
        { paddingBottom: spacing.xxxl + (footer ? 80 : insets.bottom) },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {inner}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.paddedContent]}>{inner}</View>
  );

  return (
    <SafeAreaView style={[styles.safe, style]} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
        {footer ? (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  paddedContent: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
  },
  headerBlock: { marginBottom: spacing.xl },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
  },
});
