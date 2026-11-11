import type { ReactNode } from 'react';
import { Group, Paper } from '@mattstack/app-kit/core';
import type { UsageBilling, UsageTotals } from '@mattstack/rt-client';

import type { HeroTone } from '../runs/derive/liveness';
import { Stat } from '../runs/Stat';
import { usd } from './format';
import classes from './UsageStats.module.css';

export interface UsageStat {
  key: string;
  value: ReactNode;
  label: string;
  tone?: HeroTone;
}

/** Plan usage costs nothing extra, so metered spend is the headline figure. */
export function billingStats(
  byBilling: Record<UsageBilling, UsageTotals>
): UsageStat[] {
  return [
    { key: 'metered', value: usd(byBilling.metered.cost), label: 'metered' },
    { key: 'plan', value: usd(byBilling.plan.cost), label: 'on plan' },
    ...(byBilling.unknown.cost > 0
      ? [
          {
            key: 'unknown',
            value: usd(byBilling.unknown.cost),
            label: 'unknown',
          },
        ]
      : []),
  ];
}

/** The numbers over a usage view, in one card split evenly. */
export function UsageStats({ stats }: { stats: UsageStat[] }) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      py={14}
      className={classes.line}
    >
      {stats.map(stat => (
        <Stat
          key={stat.key}
          size="h3"
          className={classes.stat}
          value={stat.value}
          label={
            <Group gap={7} wrap="nowrap" component="span">
              {stat.tone ? (
                <span className={classes.dot} data-tone={stat.tone} />
              ) : null}
              {stat.label}
            </Group>
          }
        />
      ))}
    </Paper>
  );
}
