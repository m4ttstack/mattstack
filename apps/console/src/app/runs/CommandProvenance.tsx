import { Group, Text } from '@mattstack/app-kit/core';

import { Glyph } from './Glyph';

export interface CommandProvenanceProps {
  /** The rt verb a person would type to get this panel's data. */
  command: string;
  /** `dataUpdatedAt` off the query that fetched it -- `undefined` before the
      first successful fetch. */
  asOf: number | undefined;
}

function formatAsOf(asOf: number | undefined): string {
  if (!asOf) return 'not yet fetched';
  return new Date(asOf).toLocaleTimeString();
}

/** Design law: every panel names the command that produced its data, and
    when. Kept to one quiet row -- provenance, not chrome -- so it never
    competes with the panel's own content. */
export function CommandProvenance({ command, asOf }: CommandProvenanceProps) {
  return (
    <Group gap={6} wrap="nowrap" data-testid="command-provenance">
      <Glyph name="terminal" size={12} color="dimmed" />
      <Text c="dimmed" size="sm" ff="monospace">
        {command}
      </Text>
      <Text c="dimmed" size="sm">
        as of {formatAsOf(asOf)}
      </Text>
    </Group>
  );
}
