import { Platform } from 'react-native';

// A muted, near-black palette. No saturated "brand" colors.
// Semantic colors are desaturated on purpose so that warning/danger states
// read as serious, not consumer-grade.
export const colors = {
  // Surfaces
  bg: '#0B0D10',
  surface: '#121519',
  surfaceAlt: '#171B21',
  surfaceRaised: '#1C2128',

  // Strokes
  border: '#242830',
  borderStrong: '#2E333C',
  divider: '#1D2127',

  // Text
  text: '#E6E8EB',
  textMuted: '#9AA0A6',
  textDim: '#6B7280',
  textFaint: '#4B5563',
  textInverse: '#0B0D10',

  // State colors (desaturated on purpose)
  safe: '#7A9988',       // armed, healthy
  safeSoft: '#1A2620',
  warning: '#B8975E',    // escalation / pending
  warningSoft: '#2A2216',
  danger: '#B4564F',     // grace period, release in progress, destructive
  dangerSoft: '#2A1614',
  info: '#7E95A8',       // draft, neutral
  infoSoft: '#151C23',
  terminal: '#8F6B8F',   // released, ended
  terminalSoft: '#21171F',

  // Focus
  focus: '#4C5566',
  overlay: 'rgba(0,0,0,0.72)',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  screen: 24,
} as const;

export const radii = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  pill: 999,
} as const;

const monoFamily = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'Menlo',
});

const sansFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

export const typography = {
  // Page-level title (screen headers, major transitions)
  display: {
    fontFamily: sansFamily,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    color: colors.text,
  },
  // Section / card titles
  heading: {
    fontFamily: sansFamily,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
    color: colors.text,
  },
  subheading: {
    fontFamily: sansFamily,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
    color: colors.text,
  },
  body: {
    fontFamily: sansFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
    color: colors.text,
  },
  bodyMuted: {
    fontFamily: sansFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
    color: colors.textMuted,
  },
  small: {
    fontFamily: sansFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
    color: colors.textMuted,
  },
  // Section labels — uppercased, spaced, document-like
  label: {
    fontFamily: sansFamily,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
  },
  mono: {
    fontFamily: monoFamily,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  monoSmall: {
    fontFamily: monoFamily,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
} as const;

export type StateKind = 'safe' | 'warning' | 'danger' | 'info' | 'terminal';

export const scenarioStateKind: Record<string, StateKind> = {
  draft: 'info',
  armed: 'safe',
  incident_pending: 'warning',
  escalation_in_progress: 'warning',
  grace_period: 'danger',
  release_in_progress: 'danger',
  released: 'terminal',
  aborted: 'info',
  expired: 'info',
};

export const scenarioStateLabel: Record<string, string> = {
  draft: 'Draft',
  armed: 'Armed',
  incident_pending: 'Check-in overdue',
  escalation_in_progress: 'Escalating',
  grace_period: 'Grace period',
  release_in_progress: 'Releasing',
  released: 'Released',
  aborted: 'Aborted',
  expired: 'Expired',
};

export const kindToColor = (kind: StateKind) => {
  switch (kind) {
    case 'safe':
      return { fg: colors.safe, bg: colors.safeSoft, border: colors.safe };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningSoft, border: colors.warning };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerSoft, border: colors.danger };
    case 'terminal':
      return { fg: colors.terminal, bg: colors.terminalSoft, border: colors.terminal };
    case 'info':
    default:
      return { fg: colors.textMuted, bg: colors.infoSoft, border: colors.borderStrong };
  }
};
