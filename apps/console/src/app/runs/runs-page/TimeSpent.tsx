import { Group, Paper, Progress, Stack } from '@mattstack/app-kit/core';
import { useGrow } from '@mattstack/app-kit/hooks';

import { CATEGORIES, type Category, type DayTotals } from '../derive/day';
import { formatDuration } from '../derive/duration';
import { Eyebrow } from '../Eyebrow';
import { Stat } from '../Stat';
import classes from './Summary.module.css';

/** Each part's hue; idle takes the segmented bar's soft gray. */
const TONE: Record<Category, string> = {
  work: 'ok',
  ci: 'warn',
  you: 'bad',
  idle: 'gray',
};

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
  const sum = CATEGORIES.reduce((n, c) => n + totals[c.category], 0) || 1;
  const grow = useGrow();
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
        <Eyebrow data-parity="label">
          {isToday ? "Where today's time went" : "Where that day's time went"}
        </Eyebrow>
        <Progress.Root
          variant="segmented"
          size={10}
          radius="xl"
          data-parity="bar"
        >
          {CATEGORIES.filter(c => !loading && totals[c.category] > 0).map(
            (c, i) => (
              <Progress.Section
                key={c.category}
                value={(totals[c.category] / sum) * 100}
                color={TONE[c.category]}
                className={grow('x', i).className}
                style={grow('x', i).style}
                data-category={c.category}
                data-parity={`part ${c.category}`}
              />
            )
          )}
        </Progress.Root>
        <Group gap={20} align="flex-start">
          {CATEGORIES.map(c => (
            <Stat
              key={c.category}
              value={loading ? '—' : totalText(totals[c.category])}
              label={c.label}
              data-testid={`total-${c.category}`}
            />
          ))}
        </Group>
      </Stack>
    </Paper>
  );
}
