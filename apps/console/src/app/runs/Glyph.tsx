import { Text, type MantineColor } from '@mattstack/app-kit/core';
import { Icon, type IconName } from '@mattstack/app-kit/icons';

type DataAttributes = { [key: `data-${string}`]: string | undefined };

export interface GlyphProps extends DataAttributes {
  name: IconName;
  size: number;
  /** A kit hue, `dimmed` for a muted glyph, or none for body text. */
  color?: MantineColor | 'dimmed';
}

/** An icon in a theme colour: the hue's text step, so a status glyph reads
    as its badge's label does. */
export function Glyph({ name, size, color, ...data }: GlyphProps) {
  return (
    <Text component="span" c={color} display="inline-flex" lh={0} {...data}>
      <Icon name={name} size={size} />
    </Text>
  );
}
