import { Stack, Text } from '@mattstack/app-kit/core';
import type { GateRow, RunFieldRow } from '@mattstack/rt-client';

import { formatDuration } from '../derive/duration';
import { StatusCard } from '../StatusCard';
import { Dot } from './Dot';
import { GateRecordView } from './GateRecord';
import classes from './NowCard.module.css';
import { FieldRows } from './OutputRow';

export interface NowCardProps {
  /** The current attempt: "implement", or "implement · attempt 3". */
  label: string;
  startedAt: number | null;
  lastEventAt: number;
  now: number;
  fields: RunFieldRow[];
  /** This stage's answered gates, shown before the agent records them. */
  gates?: GateRow[];
  pathHref?: (path: string) => string | null;
}

const ago = (now: number, at: number) => `${formatDuration(now - at)} ago`;

/** What the run is doing now: the current stage, how long it has run, what
    it has written so far and the gates answered during it. */
export function NowCard({
  label,
  startedAt,
  lastEventAt,
  now,
  fields,
  gates = [],
  pathHref,
}: NowCardProps) {
  const times = [
    startedAt != null ? `started ${ago(now, startedAt)}` : null,
    `last event ${ago(now, lastEventAt)}`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <StatusCard
      tone="accent"
      head={
        <>
          <Dot tone="accent" size="md" data-parity="live" />
          <Text fz="md" fw={700} lh="normal" c="accent" data-parity="title">
            Now · {label}
          </Text>
          <Text fz="md" lh="normal" c="accent" ml="auto" data-parity="times">
            {times}
          </Text>
        </>
      }
      headProps={{ 'data-parity': 'Now head' }}
      data-testid="now-card"
      data-parity={fields.length + gates.length > 0 ? 'Now' : 'Now empty'}
    >
      <Stack gap={10} className={classes.body}>
        {fields.length > 0 ? (
          <Stack gap={6} className={classes.fields}>
            <FieldRows fields={fields} pathHref={pathHref} />
          </Stack>
        ) : null}
        {gates.map(g => (
          <GateRecordView key={g.id} gate={g} />
        ))}
        {fields.length + gates.length === 0 ? (
          <Text fz="md" lh="normal" c="dimmed" data-parity="empty">
            Nothing recorded yet this stage.
          </Text>
        ) : null}
      </Stack>
    </StatusCard>
  );
}
