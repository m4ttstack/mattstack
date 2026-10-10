import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  HeatCalendar,
  Paper,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RunSummary } from '@mattstack/rt-client';

import { dayKey, heatMonth, shiftMonth } from '../derive/day';

/** A day as the calendar names it: "Wed Oct 7". */
export const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

/** The timeline's day picker, always open beside it: a month at a time,
    each day shaded by how many runs moved on it. */
export function DayCalendar({
  runs,
  now,
  day,
  onPick,
}: {
  runs: RunSummary[];
  now: number;
  /** The open day, or null for today. */
  day: string | null;
  onPick: (day: string | null) => void;
}) {
  const today = dayKey(now);
  const key = day ?? today;
  const thisMonth = shiftMonth(today, 0);
  // The month on show opens on the open day's and pages by month.
  const [month, setMonth] = useState(() => shiftMonth(key, 0));
  const weeks = useMemo(() => heatMonth(runs, now, month), [runs, now, month]);
  const monthName = new Date(`${month}T12:00:00`).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });
  const goTo = (next: string) => onPick(next === today ? null : next);
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      p={14}
      data-testid="day-calendar"
    >
      <Stack gap={12}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap={2} wrap="nowrap">
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="Previous month"
              onClick={() => setMonth(m => shiftMonth(m, -1))}
            >
              <Icon name="chevronLeft" size={14} />
            </ActionIcon>
            <Text fz="md" fw={600} lh="normal" miw={124} ta="center">
              {monthName}
            </Text>
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="Next month"
              disabled={month >= thisMonth}
              onClick={() => setMonth(m => shiftMonth(m, 1))}
            >
              <Icon name="chevronRight" size={14} />
            </ActionIcon>
          </Group>
          <Button
            variant="default"
            size="compact-sm"
            disabled={key === today && month === thisMonth}
            onClick={() => {
              setMonth(thisMonth);
              goTo(today);
            }}
          >
            Today
          </Button>
        </Group>
        <HeatCalendar
          weeks={weeks}
          hue="accent"
          showCounts="all"
          selected={key}
          dayLabel={d =>
            `${dayLabel(d.date)}, ${d.count} ${d.count === 1 ? 'run' : 'runs'}`
          }
          onPick={goTo}
        />
      </Stack>
    </Paper>
  );
}
