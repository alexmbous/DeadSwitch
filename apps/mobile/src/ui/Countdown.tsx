import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, spacing, typography } from './theme';
import { Label, Text } from './Text';

interface Props {
  /** ISO target instant. If undefined, renders an em-dash placeholder. */
  target?: string;
  /** Eyebrow above the digits. */
  label?: string;
  /** Sub-line under digits — usually the event name. */
  caption?: string;
  /** Tone tints the digits color. */
  tone?: 'safe' | 'warning' | 'danger' | 'muted';
  /** Visual scale. Dashboard uses 'lg'; inline uses 'md'. */
  size?: 'md' | 'lg';
  align?: 'left' | 'center';
  style?: ViewStyle;
}

/**
 * Live-ticking countdown to a target instant. Re-renders once per second.
 * Renders HH:MM:SS while > 1 hour, MM:SS while < 1 hour, and a friendly
 * "Now" / "Overdue" string when the target has passed.
 */
export function Countdown({
  target,
  label,
  caption,
  tone = 'muted',
  size = 'lg',
  align = 'left',
  style,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const digits = formatDigits(target, now);
  const overdue = isOverdue(target, now);
  const color =
    tone === 'safe'
      ? colors.safe
      : tone === 'warning'
      ? colors.warning
      : tone === 'danger' || overdue
      ? colors.danger
      : colors.text;

  return (
    <View style={[styles.wrap, align === 'center' && styles.center, style]}>
      {label ? (
        <Label style={[styles.label, align === 'center' && { textAlign: 'center' }]}>
          {label}
        </Label>
      ) : null}
      <Text
        style={[
          size === 'lg' ? styles.digitsLg : styles.digitsMd,
          { color },
          align === 'center' && { textAlign: 'center' },
        ]}
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabelFor(target, now)}
      >
        {digits}
      </Text>
      {caption ? (
        <Text
          style={[
            typography.bodyMuted,
            align === 'center' && { textAlign: 'center' },
            { marginTop: spacing.xs },
          ]}
        >
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isOverdue(target: string | undefined, now: number): boolean {
  if (!target) return false;
  const t = new Date(target).getTime();
  return Number.isFinite(t) && t <= now;
}

function formatDigits(target: string | undefined, now: number): string {
  if (!target) return '— —';
  const t = new Date(target).getTime();
  if (!Number.isFinite(t)) return '— —';
  let secs = Math.round((t - now) / 1000);
  if (secs <= 0) return secs > -60 ? 'Now' : 'Overdue';
  const days = Math.floor(secs / 86400);
  secs -= days * 86400;
  const hours = Math.floor(secs / 3600);
  secs -= hours * 3600;
  const mins = Math.floor(secs / 60);
  const s = secs - mins * 60;
  if (days > 0) return `${days}d ${pad(hours)}:${pad(mins)}:${pad(s)}`;
  if (hours > 0) return `${pad(hours)}:${pad(mins)}:${pad(s)}`;
  return `${pad(mins)}:${pad(s)}`;
}

function accessibilityLabelFor(target: string | undefined, now: number): string {
  if (!target) return 'No upcoming event';
  const t = new Date(target).getTime();
  if (!Number.isFinite(t)) return 'No upcoming event';
  if (t <= now) return 'Overdue';
  return `Time remaining: ${formatDigits(target, now)}`;
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  center: { alignItems: 'center' },
  label: { marginBottom: spacing.xs },
  digitsLg: {
    fontFamily: typography.mono.fontFamily,
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '500',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  digitsMd: {
    fontFamily: typography.mono.fontFamily,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '500',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
});
