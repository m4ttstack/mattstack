import { Skeleton, Text } from '@mattstack/app-kit/core';

import type { StatCard } from '../derive/lanes';
import { Dot } from '../run-page/Dot';
import classes from './StatLine.module.css';

/** Numbers rt has not answered: `loading` before the first read, `unknown`
    when the read failed, so neither draws as zero. */
export type StatsState = 'ready' | 'loading' | 'unknown';

/** The four numbers over the runs, on one line: what waits on you, what is
    live, what finished today and how long a work run takes. */
export function StatLine({
  cards,
  state = 'ready',
}: {
  cards: StatCard[];
  state?: StatsState;
}) {
  return (
    <div className={classes.line} data-parity="Summary" data-testid="stat-line">
      {cards.map(card => (
        <div
          key={card.key}
          className={classes.stat}
          data-parity={state === 'ready' ? undefined : card.role.toUpperCase()}
          data-testid={`stat-${card.key}`}
        >
          {state === 'ready' ? (
            <Dot tone={card.tone} data-parity="dot" />
          ) : null}
          {state === 'loading' ? (
            <Skeleton h={12} w={22} radius="sm" />
          ) : (
            <Text
              fz={14}
              fw={700}
              lh="normal"
              c={state === 'unknown' ? 'dimmed' : undefined}
              data-parity="v"
            >
              {state === 'unknown' ? '—' : card.value}
            </Text>
          )}
          <Text fz={13.5} lh="normal" c="dimmed" data-parity="l">
            {card.label}
          </Text>
        </div>
      ))}
    </div>
  );
}
