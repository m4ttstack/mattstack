import type { ComponentPropsWithoutRef } from 'react';

import type { HeroTone } from '../derive/liveness';
import classes from './Dot.module.css';

/** A solid status dot in a tone's fill. */
export function Dot({
  tone,
  size = 'sm',
  ...rest
}: {
  tone: HeroTone;
  size?: 'sm' | 'md';
} & Omit<ComponentPropsWithoutRef<'span'>, 'className'>) {
  return (
    <span className={classes.dot} data-tone={tone} data-size={size} {...rest} />
  );
}
