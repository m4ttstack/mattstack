import { useMemo } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateRow, RunSummary } from '@mattstack/rt-client';

import {
  activeOn,
  dayAt,
  dayDecisions,
  dayKey,
  dayTimeline,
  shiftDay,
  type DayRow,
} from '../derive/day';
import { useRunDetails } from '../useRuns';
import { DayTimeline, TimelineLegend } from './DayTimeline';
import { DecisionsToday } from './DecisionsToday';
import classes from './RunsPage.module.css';
import summary from './Summary.module.css';
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
}

/** The runs page's Day timeline: the day's runs as bars, where the time
    went and what you decided. */
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
}: TimelineViewProps) {
  const today = dayKey(now);
  const key = day ?? today;
  const from = dayAt(key);
  const to = dayAt(key, 24);
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
  });
  const settling = loading || pending;
  const decisions = useMemo(
    () => dayDecisions(runs, gates, from, to),
    [runs, gates, from, to]
  );
  const goTo = (next: string) => setUrl({ day: next === today ? null : next });

  return (
    <>
      <div className={classes.titleRow} data-parity="Title row">
        <Stack gap={4} className={classes.titleBlock}>
          <Text fz={24} fw={700} lh="normal" data-parity="title">
            {timeline.title}
          </Text>
          <Text fz={13} lh="normal" c="dimmed" data-parity="sub">
            {timeline.sub}
          </Text>
        </Stack>
        <Group gap={6} wrap="nowrap">
          <ActionIcon
            variant="default"
            size="input-sm"
            aria-label="Previous day"
            onClick={() => goTo(shiftDay(key, -1))}
          >
            <Icon name="chevronLeft" size={14} />
          </ActionIcon>
          <Button variant="default" onClick={() => goTo(today)}>
            Today
          </Button>
          <ActionIcon
            variant="default"
            size="input-sm"
            aria-label="Next day"
            disabled={key >= today}
            onClick={() => goTo(shiftDay(key, 1))}
          >
            <Icon name="chevronRight" size={14} />
          </ActionIcon>
          <ViewToggle
            view="timeline"
            onChange={view => setUrl({ view, day: null })}
          />
        </Group>
      </div>

      <TimelineLegend />

      <DayTimeline
        rows={timeline.rows}
        axis={timeline.axis}
        youMs={timeline.totals.you}
        isToday={timeline.isToday}
        loading={settling}
        titleOf={(row: DayRow) => titleOf(row.run)}
      />

      <div className={summary.row} data-parity="Summary row">
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
      </div>
    </>
  );
}
