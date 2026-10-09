import type { ReactNode } from 'react';
import { Group, Stack, Text } from '@mattstack/app-kit/core';

import type { OptionView } from '../derive/gates';
import classes from './PassedOnList.module.css';

export interface PassedOnListProps {
  options: OptionView[];
  /** Heads the list "Passed on". */
  heading?: boolean;
  /** Drawn after a recommended option's text. */
  recommendedMark?: ReactNode;
  id?: string;
  className?: string;
}

/** The options an answer passed on, one dashed row each. */
export function PassedOnList({
  options,
  heading = false,
  recommendedMark = null,
  id,
  className,
}: PassedOnListProps) {
  return (
    <Stack gap={4} id={id} className={className}>
      {heading ? (
        <Text fz={11.5} fw={500} lh="normal" c="dimmed" data-parity="h">
          Passed on
        </Text>
      ) : null}
      {options.map(o => (
        <Group key={o.value} gap={8} wrap="nowrap" data-option={o.value}>
          <span className={classes.dash} data-parity="dash" />
          <Text fz={12.5} lh="normal" c="dimmed" data-parity="t">
            {o.text}
          </Text>
          {o.recommended ? recommendedMark : null}
        </Group>
      ))}
    </Stack>
  );
}
