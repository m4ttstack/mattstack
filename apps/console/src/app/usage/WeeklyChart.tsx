import { Stack, Text, Tooltip } from '@mattstack/app-kit/core';
import type {
  UsageKind,
  UsageTotals,
  UsageWeekRow,
} from '@mattstack/rt-client';

import { KIND_LABEL, KIND_ORDER, shortDay, usd } from './format';
import classes from './WeeklyChart.module.css';

interface WeekBar {
  weekStart: number;
  cost: number;
  byKind: Partial<Record<UsageKind, UsageTotals>>;
}

/** The store skips a week with no usage, which a time axis cannot. */
export function fillWeeks(weeks: UsageWeekRow[]): WeekBar[] {
  const first = weeks[0];
  const last = weeks.at(-1);
  if (!first || !last) return [];
  const seen = new Map(weeks.map(w => [w.weekStart, w]));
  const bars: WeekBar[] = [];
  for (
    let at = new Date(first.weekStart);
    at.getTime() <= last.weekStart;
    at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 7)
  ) {
    const week = seen.get(at.getTime());
    bars.push({
      weekStart: at.getTime(),
      cost: week?.totals.cost ?? 0,
      byKind: week?.byKind ?? {},
    });
  }
  return bars;
}

/** Over the whole range, since a week with no usage still counts. */
export function averageWeek(
  cost: number,
  range: number | null,
  weeks: UsageWeekRow[]
): number {
  const count = range ? range / 7 : fillWeeks(weeks).length;
  return count > 0 ? cost / count : 0;
}

function costOf(week: WeekBar, kind: UsageKind): number {
  return week.byKind[kind]?.cost ?? 0;
}

function WeekTip({ week }: { week: WeekBar }) {
  return (
    <Stack gap={2}>
      <Text fz="sm" fw={500} lh="normal">
        {`Week of ${shortDay(week.weekStart)}: ${usd(week.cost)}`}
      </Text>
      {KIND_ORDER.filter(k => costOf(week, k) > 0).map(k => (
        <Text key={k} fz="sm" lh="normal">
          {`${KIND_LABEL[k]} ${usd(costOf(week, k))}`}
        </Text>
      ))}
    </Stack>
  );
}

/** Estimated cost per week, stacked by kind with work on the baseline. */
export function WeeklyChart({ weeks }: { weeks: UsageWeekRow[] }) {
  const bars = fillWeeks(weeks);
  const peak = Math.max(...bars.map(w => w.cost), 0);
  return (
    <div
      className={classes.chart}
      data-testid="usage-weeks"
      role="img"
      aria-label={`Estimated cost per week: ${bars
        .map(w => `${shortDay(w.weekStart)} ${usd(w.cost)}`)
        .join(', ')}`}
    >
      {bars.map(week => (
        <Tooltip key={week.weekStart} label={<WeekTip week={week} />}>
          <div className={classes.column}>
            <Text fz="sm" lh="normal" c="dimmed" className={classes.value}>
              {usd(week.cost)}
            </Text>
            <div className={classes.plot}>
              <div
                className={classes.stack}
                style={
                  {
                    '--height': peak > 0 ? week.cost / peak : 0,
                  } as React.CSSProperties
                }
              >
                {[...KIND_ORDER]
                  .reverse()
                  .filter(k => costOf(week, k) > 0)
                  .map(k => (
                    <span
                      key={k}
                      className={classes.segment}
                      data-kind={k}
                      style={
                        {
                          '--share': costOf(week, k) / week.cost,
                        } as React.CSSProperties
                      }
                    />
                  ))}
              </div>
            </div>
            <Text fz="sm" lh="normal" c="dimmed" className={classes.day}>
              {shortDay(week.weekStart)}
            </Text>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
