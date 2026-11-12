import type { ReactNode } from 'react';
import { Group, Paper } from '@mattstack/app-kit/core';
import type { UsageBilling, UsageTotals } from '@mattstack/rt-client';

import type { HeroTone } from '../runs/derive/liveness';
import { Stat } from '../runs/Stat';
import { hasKnownBilling, usd } from './format';
import classes from './UsageStats.module.css';

export interface UsageStat {
  key: string;
  value: ReactNode;
  label: string;
  tone?: HeroTone;
}

/** The total leads. Metered, on plan and unknown follow only once some cost has a known account,
 *  so history from before accounts were recorded reads as it always did. */
export function billingStats(
  total: number,
  byBilling: Record<UsageBilling, UsageTotals> | undefined,
  tone?: HeroTone
): UsageStat[] {
  const stat = (key: string, cost: number, label: string): UsageStat => ({
    key,
    value: usd(cost),
    label,
    ...(tone ? { tone } : {}),
  });
  const stats = [stat('cost', total, 'estimated cost')];
  if (!byBilling || !hasKnownBilling(byBilling)) return stats;
  stats.push(
    stat('metered', byBilling.metered.cost, 'metered'),
    stat('plan', byBilling.plan.cost, 'on plan')
  );
  if (byBilling.unknown.cost > 0)
    stats.push(stat('unknown', byBilling.unknown.cost, 'unknown'));
  return stats;
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
