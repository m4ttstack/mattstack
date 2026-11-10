import { Text } from '@mattstack/app-kit/core';

export type ShotLineData = { kind: 'caption' | 'waiver'; text: string };

/** The caption or waiver line under an evidence image; a waiver reads dimmed. */
export function ShotLine({
  line,
  size,
  lineClamp,
  dim = false,
}: {
  line?: ShotLineData | null;
  size: 'sm' | 'md';
  lineClamp?: number;
  /** Read a caption dimmed too, under a title that already leads. */
  dim?: boolean;
}) {
  if (!line) return null;
  return (
    <Text
      fz={size}
      lh="normal"
      c={dim || line.kind === 'waiver' ? 'dimmed' : undefined}
      lineClamp={lineClamp}
      data-parity={line.kind}
    >
      {line.text}
    </Text>
  );
}
