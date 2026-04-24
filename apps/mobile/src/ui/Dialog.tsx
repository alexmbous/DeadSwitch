import { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from './theme';
import { Body, Heading, Label } from './Text';
import { Button, ButtonRow } from './Button';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  eyebrow?: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  eyebrow,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {eyebrow ? <Label style={{ marginBottom: spacing.xs }}>{eyebrow}</Label> : null}
          <Heading style={{ marginBottom: spacing.sm }}>{title}</Heading>
          {typeof message === 'string' ? (
            <Body color="textMuted" style={{ marginBottom: spacing.xl }}>
              {message}
            </Body>
          ) : (
            <View style={{ marginBottom: spacing.xl }}>{message}</View>
          )}
          <ButtonRow>
            <View style={styles.flex}>
              <Button title={cancelLabel} variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.flex}>
              <Button
                title={confirmLabel}
                variant={destructive ? 'destructive' : 'primary'}
                onPress={onConfirm}
                loading={loading}
              />
            </View>
          </ButtonRow>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A lower-level modal shell for multi-step flows (arm/disarm). */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  flex: { flex: 1 },
});
