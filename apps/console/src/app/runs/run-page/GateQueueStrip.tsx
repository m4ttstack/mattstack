import { Anchor, Button, Group, Kbd, Text } from '@mattstack/app-kit/core';
import { useHotkeys } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { nowOf } from '../derive/clock';
import { formatDuration } from '../derive/duration';
import { gateName } from '../derive/gates';
import { gateQueue, type Banner } from '../derive/lanes';
import { Glyph } from '../Glyph';
import { gateHref, ticketOf } from '../runs-page/runLinks';
import { useLinkedGates } from '../runs-page/useLinkedGates';
import { StatusCard } from '../StatusCard';
import { useRunList } from '../useRuns';
import classes from './GateQueueStrip.module.css';

const SHOWN = 3;

/** The queue strip for the run on screen, once the runs and gates have
    both loaded, so it never flashes in on a partial read. */
export function RunGateQueue({ runId }: { runId: string }) {
  const runs = useRunList();
  const linked = useLinkedGates();
  if (!runs.data || !linked.loaded) return null;
  const now = nowOf(runs.data);
  return (
    <GateQueueStrip
      queue={gateQueue(runs.data.runs, linked.all, now, runId)}
      now={now}
    />
  );
}

export interface GateQueueStripProps {
  /** My waiting gates on other runs, oldest first. */
  queue: Banner[];
  now: number;
}

/** The gates waiting on me from other runs, above a run's page: the oldest
    three as links, the rest on the runs page, and Answer next (or `g`) for
    the oldest. Answering one here drops it, so the next is always first. */
export function GateQueueStrip({ queue, now }: GateQueueStripProps) {
  if (queue.length === 0) return null;
  return <Strip queue={queue} now={now} />;
}

function Strip({ queue, now }: GateQueueStripProps) {
  const next = queue[0]!;
  const nextHref = gateHref(next.run, next.gate);
  const nextTicket = ticketOf(next.run);
  const rest = queue.length - SHOWN;
  useHotkeys([
    [
      'g',
      () => {
        if (!document.querySelector('[role="dialog"]')) navigate(nextHref);
      },
    ],
  ]);

  return (
    <StatusCard
      tone="bad"
      attention="bad"
      className={classes.strip}
      headClassName={classes.head}
      data-testid="gate-queue"
      head={
        <>
          <Glyph name="hand" size={14} color="bad" />
          <Text fz="md" fw={700} lh="normal" c="bad">
            {queue.length} waiting on other runs
          </Text>
          <Group gap={6} wrap="wrap" className={classes.chips}>
            {queue.slice(0, SHOWN).map(({ run, gate }) => {
              const ticket = ticketOf(run);
              return (
                <Button
                  key={gate.id}
                  component={Link}
                  href={gateHref(run, gate)}
                  variant="default"
                  radius="xl"
                  size="compact-sm"
                  classNames={{ root: classes.chip }}
                >
                  {ticket ? (
                    <Text span fz="sm" fw={700} c="accent" mr={6}>
                      {ticket}
                    </Text>
                  ) : null}
                  <Text span fz="sm" c="dimmed">
                    {gateName(gate.kind)} ·{' '}
                    {formatDuration(now - gate.openedAt)}
                  </Text>
                </Button>
              );
            })}
            {rest > 0 ? (
              <Anchor
                component={Link}
                href="/?filter=waiting"
                fz="sm"
                fw={500}
                className={classes.chip}
              >
                +{rest} more
              </Anchor>
            ) : null}
          </Group>
          <Group gap={6} wrap="nowrap" className={classes.next}>
            <Text fz="sm" lh="normal" c="dimmed">
              or press
            </Text>
            <Kbd size="sm">g</Kbd>
            <Button
              component={Link}
              href={nextHref}
              rightSection={<Icon name="arrowRight" size={14} />}
            >
              {nextTicket ? `Answer next · ${nextTicket}` : 'Answer next'}
            </Button>
          </Group>
        </>
      }
    />
  );
}
