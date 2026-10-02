import type { ComponentPropsWithoutRef } from 'react';

import type { StatusTone } from './model/statusTone';
import classes from './statusDot.module.css';

/** A status dot. `warn` is also what needs attention in the focus list. */
export function StatusDot({
  tone,
  size = 'sm',
  ...rest
}: {
  tone: StatusTone;
  size?: 'sm' | 'md';
} & Omit<ComponentPropsWithoutRef<'span'>, 'className'>) {
  return (
    <span className={classes.dot} data-tone={tone} data-size={size} {...rest} />
  );
}
