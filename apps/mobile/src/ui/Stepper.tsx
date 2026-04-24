import { Fragment } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, spacing, typography } from './theme';
import { Text } from './Text';

interface Props {
  steps: string[];
  /** Zero-based index of the active step. */
  current: number;
  style?: ViewStyle;
}

/**
 * Progress indicator for multi-step destructive flows (arm, abort).
 *
 * The user must always know how far through a confirmation flow they are;
 * a sheet without a stepper feels like a single dialog and encourages
 * careless taps. Numbered circles + labels + connector lines.
 */
export function Stepper({ steps, current, style }: Props) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="progressbar">
      {steps.map((label, i) => {
        const isDone = i < current;
        const isActive = i === current;
        const fg = isActive ? colors.text : isDone ? colors.textMuted : colors.textFaint;
        const ring = isActive
          ? colors.text
          : isDone
          ? colors.textMuted
          : colors.borderStrong;
        return (
          <Fragment key={i}>
            <View style={styles.stepCol}>
              <View
                style={[
                  styles.dot,
                  { borderColor: ring, backgroundColor: isActive ? colors.text : 'transparent' },
                ]}
              >
                <Text
                  style={[
                    typography.label,
                    {
                      color: isActive ? colors.textInverse : fg,
                      letterSpacing: 0,
                      fontSize: 12,
                    },
                  ]}
                >
                  {i + 1}
                </Text>
              </View>
              <Text
                style={[typography.label, { color: fg, marginTop: 6, textAlign: 'center' }]}
                numberOfLines={2}
              >
                {label}
              </Text>
            </View>
            {i < steps.length - 1 ? (
              <View
                style={[
                  styles.connector,
                  { backgroundColor: i < current ? colors.textMuted : colors.border },
                ]}
              />
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
  },
  stepCol: {
    flexBasis: 90,
    alignItems: 'center',
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    flex: 1,
    height: 1,
    marginTop: 14,
    marginHorizontal: 4,
  },
});
