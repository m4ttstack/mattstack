import { Group, Paper, Stack, Text } from '@mattstack/app-kit/core';
import type { RunFieldRow } from '@mattstack/rt-client';

import { formatDuration } from '../derive/duration';
import { Dot } from './Dot';
import classes from './NowCard.module.css';
import { FieldRows } from './OutputRow';

export interface NowCardProps {
  /** The current attempt: "implement", or "implement · attempt 3". */
  label: string;
  startedAt: number | null;
  lastEventAt: number;
  now: number;
  fields: RunFieldRow[];
  pathHref?: (path: string) => string | null;
}

const ago = (now: number, at: number) => `${formatDuration(now - at)} ago`;

/** What the run is doing now: the current stage, how long it has run, and
    what it has written so far. */
export function NowCard({
  label,
  startedAt,
  lastEventAt,
  now,
  fields,
  pathHref,
}: NowCardProps) {
  const times = [
    startedAt != null ? `started ${ago(now, startedAt)}` : null,
    `last event ${ago(now, lastEventAt)}`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.card}
      data-testid="now-card"
      data-parity={fields.length > 0 ? 'Now' : 'Now empty'}
    >
      <div className={classes.head} data-parity="Now head">
        <Group gap={8} wrap="nowrap" className={classes.headRow}>
          <Dot tone="accent" size="md" data-parity="live" />
          <Text fz={12.5} fw={700} lh="normal" c="accent" data-parity="title">
            Now · {label}
          </Text>
          <span className={classes.spacer} />
          <Text fz={12} lh="normal" c="accent" data-parity="times">
            {times}
          </Text>
        </Group>
      </div>
      <Stack gap={10} className={classes.body}>
        {fields.length > 0 ? (
          <Stack gap={6} className={classes.fields}>
            <FieldRows fields={fields} pathHref={pathHref} />
          </Stack>
        ) : (
          <Text fz={12.5} lh="normal" c="dimmed" data-parity="empty">
            Nothing recorded yet this stage.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
