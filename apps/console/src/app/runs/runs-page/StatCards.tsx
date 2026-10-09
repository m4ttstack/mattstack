import { Group, Paper, Stack, Text } from '@mattstack/app-kit/core';

import type { StatCard } from '../derive/lanes';
import { Dot } from '../run-page/Dot';
import classes from './StatCards.module.css';

/** The four numbers over the runs: what waits on you, what is live, what
    finished today and how long a work run takes. */
export function StatCards({ cards }: { cards: StatCard[] }) {
  return (
    <div className={classes.row} data-testid="stat-cards">
      {cards.map(card => (
        <Paper
          key={card.role}
          variant="ground"
          withBorder
          radius={12}
          className={classes.card}
          data-parity={`Stat ${card.role}`}
          data-testid={`stat-${card.subLayer}`}
        >
          <Stack gap={6}>
            <Group gap={6} wrap="nowrap">
              <Dot tone={card.tone} data-parity="dot" />
              <Text
                fz={10.5}
                fw={500}
                lh="normal"
                tt="uppercase"
                lts={0.8}
                c="dimmed"
                data-parity="label"
              >
                {card.role}
              </Text>
            </Group>
            <Text
              fz={22}
              fw={700}
              lh="normal"
              data-parity={card.subLayer === 'window' ? 'median' : 'value'}
            >
              {card.value}
            </Text>
            <Text fz={12} lh="normal" c="dimmed" data-parity={card.subLayer}>
              {card.sub}
            </Text>
          </Stack>
        </Paper>
      ))}
    </div>
  );
}
