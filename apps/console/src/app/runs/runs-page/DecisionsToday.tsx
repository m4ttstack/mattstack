import { Group, Paper, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { decisionCount, decisionText, type DayDecision } from '../derive/day';
import { ticketOf } from './runLinks';
import classes from './Summary.module.css';

/** The gates you answered on the day, newest first. */
export function DecisionsToday({
  decisions,
  isToday,
  loading,
}: {
  decisions: DayDecision[];
  isToday: boolean;
  /** The gates have not landed yet. */
  loading: boolean;
}) {
  const when = isToday ? 'today' : 'that day';
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.card}
      data-parity="Decisions card"
      data-testid="decisions-today"
    >
      <Stack gap={10}>
        <Text
          fz={10.5}
          fw={500}
          lh="normal"
          tt="uppercase"
          lts={0.8}
          c="dimmed"
          data-parity="label"
        >
          {loading
            ? `Decisions you made ${when}`
            : `Decisions you made ${when} · ${decisionCount(decisions)}`}
        </Text>
        {loading ? (
          <Text fz={12.5} lh="normal" c="dimmed">
            Loading your answers…
          </Text>
        ) : decisions.length === 0 ? (
          <Text fz={12.5} lh="normal" c="dimmed">
            {`You answered no gates ${when}.`}
          </Text>
        ) : (
          decisions.map(({ gate, run }) => (
            <Group
              key={gate.id}
              gap={8}
              wrap="nowrap"
              className={classes.decision}
              data-testid={`decision-${gate.id}`}
            >
              <Icon
                name="signpost"
                size={13}
                color="var(--tk-text-3)"
                data-parity="signpost"
              />
              {ticketOf(run) ? (
                <Text
                  fz={12}
                  fw={700}
                  lh="normal"
                  className={classes.keep}
                  data-parity="ticket"
                >
                  {ticketOf(run)}
                </Text>
              ) : null}
              <Text fz={12.5} lh="normal" truncate data-parity="text">
                {decisionText(gate)}
              </Text>
            </Group>
          ))
        )}
      </Stack>
    </Paper>
  );
}
