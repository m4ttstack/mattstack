import { Group, Paper, Skeleton, Stack, Text } from '@mattstack/app-kit/core';

import type { StatCard } from '../derive/lanes';
import { Dot } from '../run-page/Dot';
import classes from './StatCards.module.css';

/** Numbers rt has not answered: `loading` before the first read, `unknown`
    when the read failed, so neither draws as zero. */
export type StatsState = 'ready' | 'loading' | 'unknown';

/** The four numbers over the runs: what waits on you, what is live, what
    finished today and how long a work run takes. */
export function StatCards({
  cards,
  state = 'ready',
}: {
  cards: StatCard[];
  state?: StatsState;
}) {
  return (
    <div className={classes.row} data-testid="stat-cards">
      {cards.map(card => (
        <Paper
          key={card.role}
          variant="ground"
          withBorder
          radius={12}
          className={classes.card}
          data-parity={
            state === 'ready' ? `Stat ${card.role}` : card.role.toUpperCase()
          }
          data-testid={`stat-${card.subLayer}`}
        >
          <Stack gap={6}>
            <Group gap={6} wrap="nowrap">
              {state === 'ready' ? (
                <Dot tone={card.tone} data-parity="dot" />
              ) : null}
              <Text
                fz={10.5}
                fw={500}
                lh="normal"
                tt="uppercase"
                lts={0.8}
                c="dimmed"
                data-parity={state === 'ready' ? 'label' : 'l'}
              >
                {card.role}
              </Text>
            </Group>
            {state === 'loading' ? (
              <Stack gap={8} className={classes.pending}>
                <Skeleton h={22} w={48} radius="sm" />
                <Skeleton h={10} w="70%" radius="sm" />
              </Stack>
            ) : state === 'unknown' ? (
              <Text fz={22} fw={700} lh="normal" c="dimmed" data-parity="v">
                —
              </Text>
            ) : (
              <>
                <Text
                  fz={22}
                  fw={700}
                  lh="normal"
                  data-parity={card.subLayer === 'window' ? 'median' : 'value'}
                >
                  {card.value}
                </Text>
                <Text
                  fz={12}
                  lh="normal"
                  c="dimmed"
                  data-parity={card.subLayer}
                >
                  {card.sub}
                </Text>
              </>
            )}
          </Stack>
        </Paper>
      ))}
    </div>
  );
}
