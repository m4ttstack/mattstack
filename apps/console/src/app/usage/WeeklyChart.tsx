import { Stack, Text, Tooltip } from '@mattstack/app-kit/core';
import type { UsageWeekRow } from '@mattstack/rt-client';

import { KIND_LABEL, KIND_ORDER, shortDay, usd } from './format';
import classes from './WeeklyChart.module.css';

function WeekTip({ week }: { week: UsageWeekRow }) {
  return (
    <Stack gap={2}>
      <Text fz="sm" fw={500} lh="normal">
        {`Week of ${shortDay(week.weekStart)}: ${usd(week.totals.cost)}`}
      </Text>
      {KIND_ORDER.filter(k => week.byKind[k].cost > 0).map(k => (
        <Text key={k} fz="sm" lh="normal">
          {`${KIND_LABEL[k]} ${usd(week.byKind[k].cost)}`}
        </Text>
      ))}
    </Stack>
  );
}

/** Estimated cost per week, stacked by kind. */
export function WeeklyChart({ weeks }: { weeks: UsageWeekRow[] }) {
  const peak = Math.max(...weeks.map(w => w.totals.cost), 0);
  return (
    <div className={classes.chart} data-testid="usage-weeks">
      {weeks.map(week => (
        <Tooltip key={week.weekStart} label={<WeekTip week={week} />}>
          <div className={classes.column}>
            <Text fz="sm" lh="normal" c="dimmed" className={classes.value}>
              {usd(week.totals.cost)}
            </Text>
            <div
              className={classes.stack}
              style={
                {
                  '--height': peak > 0 ? week.totals.cost / peak : 0,
                } as React.CSSProperties
              }
            >
              {KIND_ORDER.filter(k => week.byKind[k].cost > 0)
                .reverse()
                .map(k => (
                  <span
                    key={k}
                    className={classes.segment}
                    data-kind={k}
                    style={
                      {
                        '--share': week.byKind[k].cost / week.totals.cost,
                      } as React.CSSProperties
                    }
                  />
                ))}
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
