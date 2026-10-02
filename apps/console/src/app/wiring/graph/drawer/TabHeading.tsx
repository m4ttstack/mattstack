import type { ReactNode } from 'react';
import { Text } from '@mattstack/app-kit/core';

/** A section label inside a drawer tab. */
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
      fz={10}
      fw={500}
      lh="normal"
      lts="0.8px"
      tt="uppercase"
      c="var(--tk-text-3)"
      data-parity={parity}
      data-testid={testId}
    >
      {children}
    </Text>
  );
}
