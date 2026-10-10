import { Fragment } from 'react';
import { Divider, Group, Paper, Skeleton, Text } from '@mattstack/app-kit/core';

import type { StatCard } from '../derive/lanes';
import { Dot } from '../run-page/Dot';
import { Stat } from '../Stat';
import classes from './StatLine.module.css';

/** Numbers rt has not answered: `loading` before the first read, `unknown`
    when the read failed, so neither draws as zero. */
export type StatsState = 'ready' | 'loading' | 'unknown';

/** The four numbers over the runs, in one card split four ways: what waits
    on you, what is live, what finished today and how long a work run takes. */
export function StatLine({
  cards,
  state = 'ready',
}: {
  cards: StatCard[];
  state?: StatsState;
}) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      py={14}
      className={classes.line}
      data-parity="Summary"
      data-testid="stat-line"
    >
      {cards.map((card, i) => (
        <Fragment key={card.key}>
          {i > 0 ? <Divider orientation="vertical" /> : null}
          <Stat
            size="h2"
            className={classes.stat}
            data-parity={
              state === 'ready' ? undefined : card.role.toUpperCase()
            }
            data-testid={`stat-${card.key}`}
            value={
              state === 'loading' ? (
                <Skeleton h={28} w={40} radius="sm" />
              ) : state === 'unknown' ? (
                <Text inherit c="dimmed" span>
                  —
                </Text>
              ) : (
                card.value
              )
            }
            label={
              <Group gap={7} wrap="nowrap" component="span">
                {state === 'ready' ? (
                  <Dot tone={card.tone} data-parity="dot" />
                ) : null}
                {card.label}
              </Group>
            }
          />
        </Fragment>
      ))}
    </Paper>
  );
}
