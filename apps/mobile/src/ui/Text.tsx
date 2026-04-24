import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { typography, colors } from './theme';

type Variant =
  | 'display'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyMuted'
  | 'small'
  | 'label'
  | 'mono'
  | 'monoSmall';

interface Props extends TextProps {
  variant?: Variant;
  color?: keyof typeof colors;
  align?: TextStyle['align'] | 'left' | 'center' | 'right';
  weight?: '400' | '500' | '600' | '700';
}

export function Text({ variant = 'body', color, align, weight, style, ...rest }: Props) {
  const base = typography[variant];
  const override: TextStyle = {};
  if (color) override.color = colors[color];
  if (align) override.textAlign = align as TextStyle['textAlign'];
  if (weight) override.fontWeight = weight;
  return <RNText {...rest} style={[base, override, style]} />;
}

export const Display = (p: Props) => <Text variant="display" {...p} />;
export const Heading = (p: Props) => <Text variant="heading" {...p} />;
export const SubHeading = (p: Props) => <Text variant="subheading" {...p} />;
export const Body = (p: Props) => <Text variant="body" {...p} />;
export const BodyMuted = (p: Props) => <Text variant="bodyMuted" {...p} />;
export const Small = (p: Props) => <Text variant="small" {...p} />;
export const Label = (p: Props) => <Text variant="label" {...p} />;
export const Mono = (p: Props) => <Text variant="mono" {...p} />;
export const MonoSmall = (p: Props) => <Text variant="monoSmall" {...p} />;
