import {
  Badge,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from '@mattstack/app-kit/core';

import { decisionCount, decisionText, type DayDecision } from '../derive/day';
import { modeOf } from '../derive/modeFeed';
import { Eyebrow } from '../Eyebrow';
import { Glyph } from '../Glyph';
import scrollFit from '../scrollFit.module.css';
import { ticketOf } from './runLinks';
import classes from './Summary.module.css';

/** The gates you, or the runs' modes, answered on the day, newest first.
    Read-only: Pause and Redo live on the live lanes and the run page. */
export function DecisionsToday({
  decisions,
  isToday,
  loading,
  by = 'you',
}: {
  decisions: DayDecision[];
  isToday: boolean;
  /** The gates have not landed yet. */
  loading: boolean;
  by?: 'you' | 'mode';
}) {
  const when = isToday ? 'today' : 'that day';
  const label =
    by === 'mode'
      ? `Decisions the mode made ${when}`
      : `Decisions you made ${when}`;
  const none =
    by === 'mode'
      ? `No mode answered a gate ${when}.`
      : `You answered no gates ${when}.`;
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.card}
      data-parity={by === 'mode' ? 'Mode decisions card' : 'Decisions card'}
      data-testid={by === 'mode' ? 'mode-decisions-today' : 'decisions-today'}
    >
      <Stack gap={10}>
        <Eyebrow data-parity="label">
          {loading ? label : `${label} · ${decisionCount(decisions)}`}
        </Eyebrow>
        {loading ? (
          <Text fz="md" lh="normal" c="dimmed">
            Loading your answers…
          </Text>
        ) : decisions.length === 0 ? (
          <Text fz="md" lh="normal" c="dimmed">
            {none}
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
                      fw={500}
                      lh="normal"
                      className={classes.keep}
                      data-parity="ticket"
                    >
                      {ticketOf(run)}
                    </Text>
                  ) : null}
                  {by === 'mode' && modeOf(gate) ? (
                    <Badge size="sm" color="blue" className={classes.keep}>
                      {modeOf(gate)}
                    </Badge>
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
