import type { ReactNode } from 'react';
import { Text } from '@mattstack/app-kit/core';

/** A Button's label is as tall as the button; its text is the board's layer. */
export function ButtonLabel({ children }: { children: ReactNode }) {
  return (
    <Text span fz={12} fw={500} lh="normal" data-parity="l">
      {children}
    </Text>
  );
}
