import { ThemeIcon, type ThemeIconProps } from '@mattstack/app-kit/core';

import type { HeroTone } from '../derive/liveness';

/** A solid status dot in a tone's fill: a kit ThemeIcon with no glyph. */
export function Dot({
  tone,
  size = 'sm',
  ...rest
}: {
  tone: HeroTone;
  size?: 'sm' | 'md';
} & Omit<ThemeIconProps, 'color' | 'size' | 'radius' | 'children'> & {
    'data-parity'?: string;
  }) {
  return (
    <ThemeIcon
      size={size === 'md' ? 8 : 7}
      radius="xl"
      color={tone}
      aria-hidden
      data-tone={tone}
      {...rest}
    />
  );
}
