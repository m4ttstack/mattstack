import type { ReactNode } from 'react';
import { Group, Paper } from '@mattstack/app-kit/core';

import type { HeroTone } from '../runs/derive/liveness';
import { Stat } from '../runs/Stat';
import classes from './UsageStats.module.css';

export interface UsageStat {
  key: string;
  value: ReactNode;
  label: string;
  tone?: HeroTone;
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
          size="h2"
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
