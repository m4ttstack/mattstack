import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Paper } from '@mattstack/app-kit/core';

import classes from './StatusCard.module.css';

export type StatusTone = 'accent' | 'warn' | 'bad';

type DataAttributes = { [key: `data-${string}`]: string | undefined };

export interface StatusCardProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'color'
> {
  /** The hue the head band is washed in; none leaves it on the panel. */
  tone?: StatusTone;
  /** Rings the card, as a ground card that needs you does. */
  attention?: 'warn' | 'bad';
  head: ReactNode;
  headClassName?: string;
  headProps?: DataAttributes;
  children?: ReactNode;
}

/** A ground card whose head band carries what it is about and how long it
    has been so: the Now card, a handoff, a gate, the waiting banner. */
export function StatusCard({
  tone,
  attention,
  head,
  headClassName,
  headProps,
  className,
  children,
  ...rest
}: StatusCardProps) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      data-attention={attention}
      className={className ? `${classes.card} ${className}` : classes.card}
      {...rest}
    >
      <div
        className={
          headClassName ? `${classes.head} ${headClassName}` : classes.head
        }
        data-tone={tone}
        {...headProps}
      >
        {head}
      </div>
      {children}
    </Paper>
  );
}
