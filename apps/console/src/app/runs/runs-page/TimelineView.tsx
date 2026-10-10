import { useMemo, useState } from 'react';
import {
  Group,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateRow, RunSummary } from '@mattstack/rt-client';

import {
  activeOn,
  dayDecisions,
  dayKey,
  dayTimeline,
  dayWindow,
  shiftDay,
  type DayRow,
} from '../derive/day';
import { MainSide } from '../MainSide';
import { useRunDetails } from '../useRuns';
import { DayCalendar } from './DayCalendar';
import { DayTimeline, TimelineLegend } from './DayTimeline';
import { DecisionsToday } from './DecisionsToday';
import classes from './RunsPage.module.css';
import { TimeSpent } from './TimeSpent';
import type { RunsUrl, RunsViewName } from './useRunsUrl';

const VIEWS: { value: RunsViewName; label: string }[] = [
  { value: 'timeline', label: 'Timeline' },
  { value: 'lanes', label: 'List' },
];

/** Timeline or List (the Lanes), on both views of the runs page. */
export function ViewToggle({
  view,
  onChange,
}: {
  view: RunsViewName;
  onChange: (view: RunsViewName) => void;
}) {
  return (
    <SegmentedControl
      aria-label="View"
      data={VIEWS}
      value={view}
      onChange={v => onChange(v as RunsViewName)}
    />
  );
}

export interface TimelineViewProps {
  runs: RunSummary[];
  gates: GateRow[];
  gatesByRun: Map<string, GateRow[]>;
  /** The runs or their gates have not landed yet. */
  loading: boolean;
  /** The repo `?repo=` filters to, or null for every repo. */
  repoName: string | null;
  now: number;
  day: string | null;
  setUrl: (patch: Partial<RunsUrl>) => void;
  titleOf: (run: RunSummary) => string;
  /** The page frame's height, which the lanes may grow into. */
  height: string;
}

/** The runs page's Day timeline: the day's runs as bars, where the time
    went and what you decided. */
/** Everything around the lanes in the page frame: padding, the title and
    legend rows with their gaps, the axis and the hint. */
const TIMELINE_CHROME_PX = 300;

export function TimelineView({
  runs,
  gates,
  gatesByRun,
  loading,
  repoName,
  now,
  day,
  setUrl,
  titleOf,
  height,
}: TimelineViewProps) {
  const today = dayKey(now);
  // Today opens on the hours you are in (the working day from 8 AM to 6 PM,
  // the night outside it); any other day opens on its working day. A pick
  // holds only for the day it was made on.
  const [picked, setPicked] = useState<{
    day: string | null;
    hours: 'day' | 'night';
  } | null>(null);
  const clockHour = new Date(now).getHours();
  const hours =
    picked && picked.day === day
      ? picked.hours
      : day == null && (clockHour < 8 || clockHour >= 18)
        ? 'night'
        : 'day';
  const setHours = (next: 'day' | 'night') => setPicked({ day, hours: next });
  const overnight = hours === 'night';
  // Before 8 AM the night you are in began the evening before.
  const key =
    day ??
    (overnight && new Date(now).getHours() < 8 ? shiftDay(today, -1) : today);
  const { from, to } = dayWindow(key, overnight);
  const active = useMemo(
    () => runs.filter(r => activeOn(r, from, to, now)),
    [runs, from, to, now]
  );
  const { details, pending } = useRunDetails(active);
  const timeline = dayTimeline({
    runs,
    details,
    gatesByRun,
    key,
    now,
    repoName,
    overnight,
  });
  const settling = loading || pending;
  const decisions = useMemo(
    () => dayDecisions(runs, gates, from, to),
    [runs, gates, from, to]
  );

  return (
    <>
      <div className={classes.titleRow} data-parity="Title row">
        <Stack gap={4} className={classes.titleBlock}>
          <Text fz="h1" fw={700} lh="normal" data-parity="title">
            {timeline.title}
          </Text>
          <Text fz="lg" lh="normal" c="dimmed" data-parity="sub">
            {timeline.sub}
          </Text>
        </Stack>
        <ViewToggle
          view="timeline"
          onChange={view => setUrl({ view, day: null })}
        />
      </div>

      <MainSide
        main={
          <Stack gap={16}>
            <Group justify="space-between" wrap="nowrap">
              <TimelineLegend />
              <SegmentedControl
                size="xs"
                aria-label="Hours shown"
                value={hours}
                onChange={v => setHours(v as 'day' | 'night')}
                data={[
                  {
                    value: 'day',
                    label: (
                      <Tooltip label="Working day, 8 AM to 6 PM">
                        <Group gap={6} wrap="nowrap">
                          <Icon name="sun" size={14} />
                          Day
                        </Group>
                      </Tooltip>
                    ),
                  },
                  {
                    value: 'night',
                    label: (
                      <Tooltip label="Whole day, overnight too">
                        <Group gap={6} wrap="nowrap">
                          <Icon name="moon" size={14} />
                          Night
                        </Group>
                      </Tooltip>
                    ),
                  },
                ]}
              />
            </Group>

            <DayTimeline
              rows={timeline.rows}
              axis={timeline.axis}
              youMs={timeline.totals.you}
              isToday={timeline.isToday}
              loading={settling}
              titleOf={(row: DayRow) => titleOf(row.run)}
              // The frame less the page padding, the title row, the legend row,
              // the axis and the hint, so the card fills the page and no more.
              lanesMaxHeight={`calc(${height} - ${TIMELINE_CHROME_PX}px)`}
            />
          </Stack>
        }
        side={
          <Stack gap={16}>
            <DayCalendar
              runs={runs}
              now={now}
              day={day}
              onPick={next => setUrl({ day: next })}
            />
            <TimeSpent
              totals={timeline.totals}
              isToday={timeline.isToday}
              loading={settling}
            />
            <DecisionsToday
              decisions={decisions}
              isToday={timeline.isToday}
              loading={loading}
            />
          </Stack>
        }
      />
    </>
  );
}
