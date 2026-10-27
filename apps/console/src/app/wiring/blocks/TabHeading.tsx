import type { ReactNode } from 'react';
import { Text } from '@mattstack/app-kit/core';

/** A section label inside a block's History or Used by. */
export function TabHeading({
  children,
  parity,
  testId,
}: {
  children: ReactNode;
  parity: string;
  testId?: string;
}) {
  return (
    <Text
      fz={11}
      fw={500}
      lh="normal"
      lts="0.8px"
      tt="uppercase"
      c="var(--tk-text-2)"
      data-parity={parity}
      data-testid={testId}
    >
      {children}
    </Text>
  );
}
