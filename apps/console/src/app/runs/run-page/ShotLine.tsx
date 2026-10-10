import { Text } from '@mattstack/app-kit/core';

export type ShotLineData = { kind: 'caption' | 'waiver'; text: string };

/** The caption or waiver line under an evidence image; a waiver reads dimmed. */
export function ShotLine({
  line,
  size,
}: {
  line?: ShotLineData | null;
  size: 'sm' | 'md';
}) {
  if (!line) return null;
  return (
    <Text
      fz={size}
      lh="normal"
      c={line.kind === 'waiver' ? 'dimmed' : undefined}
      data-parity={line.kind}
    >
      {line.text}
    </Text>
  );
}
