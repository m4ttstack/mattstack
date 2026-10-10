import type { ReactNode } from 'react';
import { Stack, Text, type MantineFontSize } from '@mattstack/app-kit/core';

type DataAttributes = { [key: `data-${string}`]: string | undefined };

export interface StatProps extends DataAttributes {
  value: ReactNode;
  label: ReactNode;
  /** The number's size: `xl` in a card's totals, `h2` in a record's hero. */
  size?: MantineFontSize;
  className?: string;
}

/** A big number over the word that says what it counts. */
export function Stat({
  value,
  label,
  size = 'xl',
  className,
  ...data
}: StatProps) {
  return (
    <Stack gap={2} miw={0} className={className} {...data}>
      <Text fz={size} fw={700} lh="normal" data-parity="value">
        {value}
      </Text>
      <Text fz="md" lh="normal" data-parity="label">
        {label}
      </Text>
    </Stack>
  );
}
