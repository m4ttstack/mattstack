import {
  ActionIcon,
  Anchor,
  Group,
  Paper,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from 'wouter';

import type { LaneFacts } from '../derive/lanes';
import { focusPane, LivenessBadge } from '../LivenessBadge';
import { StageRail } from '../run-page/StageRail';
import classes from './LiveLane.module.css';

export interface LiveLaneProps {
  runId: string;
  ticket: string | null;
  title: string;
  href: string;
  facts: LaneFacts;
}

/** A live run as a card: its ticket, MR and decisions over its title, then a
    band with its rail, the stage it is in and how long it has run. */
export function LiveLane({ runId, ticket, title, href, facts }: LiveLaneProps) {
  const { liveness, focusPane: pane } = facts;
  const waiting = liveness.waiting === true;
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.lane}
      data-parity="Lane"
      data-testid={`lane-${runId}`}
    >
      <div className={classes.top}>
        <Group gap={14} wrap="nowrap" className={classes.full}>
          {ticket ? (
            <Anchor
              component={Link}
              href={href}
              fz="sm"
              fw={500}
              lh="normal"
              data-parity="ticket"
            >
              {ticket}
            </Anchor>
          ) : null}
          {facts.mr ? (
            <Group gap={5} wrap="nowrap" c="dimmed">
              <Icon
                name="gitPullRequest"
                size={13}
                data-parity="git-pull-request"
              />
              <Text fz="sm" lh="normal" data-parity="mr text">
                {facts.mr}
              </Text>
            </Group>
          ) : null}
          <Group gap={5} wrap="nowrap" c="dimmed">
            <Icon name="signpost" size={13} data-parity="signpost" />
            <Text fz="sm" lh="normal" data-parity="decisions">
              {facts.decisions}
            </Text>
          </Group>
          <span className={classes.spacer} />
          <LivenessBadge liveness={liveness} />
          {pane ? (
            <Tooltip label="Focus the agent's pane">
              <ActionIcon
                variant="default"
                aria-label="focus pane"
                onClick={() => void focusPane(pane)}
                className={classes.focus}
                data-parity="focus"
              >
                <Icon
                  name="squareTerminal"
                  size={14}
                  data-parity="square-terminal"
                />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
        <Anchor
          component={Link}
          href={href}
          fz="md"
          fw={400}
          lh={1.4}
          c="bright"
          className={classes.full}
          data-parity="title"
        >
          {title}
        </Anchor>
      </div>
      <div
        className={classes.band}
        data-waiting={waiting || undefined}
        data-parity="footer"
      >
        {facts.rail ? <StageRail stages={facts.rail} compact /> : null}
        <Group gap={8} wrap="nowrap" className={classes.full}>
          {facts.stage ? (
            <Text
              fz="sm"
              fw={500}
              lh="normal"
              c={waiting ? 'bad' : undefined}
              data-parity="stage"
            >
              {facts.stage}
            </Text>
          ) : null}
          {facts.elapsed ? (
            <Text fz="sm" lh="normal" c="dimmed" data-parity="elapsed">
              {facts.elapsed}
            </Text>
          ) : null}
          <span className={classes.spacer} />
          <Text fz="sm" lh="normal" c="dimmed" data-parity="age">
            {facts.age}
          </Text>
        </Group>
      </div>
    </Paper>
  );
}
