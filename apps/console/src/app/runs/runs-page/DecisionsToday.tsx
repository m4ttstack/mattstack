import { Group, Paper, ScrollArea, Stack, Text } from '@mattstack/app-kit/core';

import { decisionCount, decisionText, type DayDecision } from '../derive/day';
import { Eyebrow } from '../Eyebrow';
import { Glyph } from '../Glyph';
import scrollFit from '../scrollFit.module.css';
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
        <Eyebrow data-parity="label">
          {loading
            ? `Decisions you made ${when}`
            : `Decisions you made ${when} · ${decisionCount(decisions)}`}
        </Eyebrow>
        {loading ? (
          <Text fz="md" lh="normal" c="dimmed">
            Loading your answers…
          </Text>
        ) : decisions.length === 0 ? (
          <Text fz="md" lh="normal" c="dimmed">
            {`You answered no gates ${when}.`}
          </Text>
        ) : (
          // A long day's decisions scroll inside the card.
          <ScrollArea.Autosize
            mah={360}
            type="auto"
            scrollbars="y"
            classNames={{ root: scrollFit.root, content: scrollFit.content }}
          >
            <Stack gap={10}>
              {decisions.map(({ gate, run }) => (
                <Group
                  key={gate.id}
                  gap={8}
                  wrap="nowrap"
                  className={classes.decision}
                  data-testid={`decision-${gate.id}`}
                >
                  <Glyph
                    name="signpost"
                    size={13}
                    color="dimmed"
                    data-parity="signpost"
                  />
                  {ticketOf(run) ? (
                    <Text
                      fz="md"
                      fw={700}
                      lh="normal"
                      className={classes.keep}
                      data-parity="ticket"
                    >
                      {ticketOf(run)}
                    </Text>
                  ) : null}
                  <Text fz="md" lh="normal" truncate data-parity="text">
                    {decisionText(gate)}
                  </Text>
                </Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Stack>
    </Paper>
  );
}
