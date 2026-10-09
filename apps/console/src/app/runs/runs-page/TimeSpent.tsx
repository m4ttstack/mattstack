import type { CSSProperties } from 'react';
import { Paper, Stack, Text } from '@mattstack/app-kit/core';

import { CATEGORIES, type DayTotals } from '../derive/day';
import { formatDuration } from '../derive/duration';
import classes from './Summary.module.css';

const totalText = (ms: number) => (ms < 60_000 ? '0m' : formatDuration(ms));

/** Where the day's time went across its runs: a stacked bar and the four
    totals. */
export function TimeSpent({
  totals,
  isToday,
  loading,
}: {
  totals: DayTotals;
  isToday: boolean;
  /** The bars have not landed, so no total is known yet. */
  loading: boolean;
}) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.card}
      data-parity="Time card"
      data-testid="time-spent"
    >
      <Stack gap={12}>
        <Text
          fz={10.5}
          fw={500}
          lh="normal"
          tt="uppercase"
          lts={0.8}
          c="dimmed"
          data-parity="label"
        >
          {isToday ? "Where today's time went" : "Where that day's time went"}
        </Text>
        <div className={classes.stack}>
          {CATEGORIES.filter(c => !loading && totals[c.category] > 0).map(c => (
            <div
              key={c.category}
              className={classes.part}
              data-category={c.category}
              style={{ '--share': totals[c.category] } as CSSProperties}
              data-parity={`part ${c.category}`}
            />
          ))}
        </div>
        <div className={classes.totals}>
          {CATEGORIES.map(c => (
            <Stack key={c.category} gap={2} data-testid={`total-${c.category}`}>
              <Text fz={15} fw={700} lh="normal" data-parity="value">
                {loading ? '—' : totalText(totals[c.category])}
              </Text>
              <Text fz={12} lh="normal" c="dimmed" data-parity="label">
                {c.label}
              </Text>
            </Stack>
          ))}
        </div>
      </Stack>
    </Paper>
  );
}
