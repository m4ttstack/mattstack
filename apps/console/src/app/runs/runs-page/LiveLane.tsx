import {
  ActionIcon,
  Anchor,
  Divider,
  Group,
  Paper,
  Stack,
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

/** A live run as a card: who drives it, its rail, the stage it is in and
    what it last wrote, its MR and how many decisions it has taken. */
export function LiveLane({ runId, ticket, title, href, facts }: LiveLaneProps) {
  const { liveness, focusPane: pane } = facts;
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.lane}
      data-parity="Lane"
      data-testid={`lane-${runId}`}
    >
      <Group gap={8} wrap="nowrap" className={classes.full}>
        {ticket ? (
          <Anchor
            component={Link}
            href={href}
            fz="lg"
            fw={700}
            lh="normal"
            data-parity="ticket"
          >
            {ticket}
          </Anchor>
        ) : null}
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
        fz="xl"
        fw={500}
        lh="normal"
        c="bright"
        className={classes.full}
        data-parity="title"
      >
        {title}
      </Anchor>
      <div className={classes.now}>
        {facts.rail ? <StageRail stages={facts.rail} compact /> : null}
        {facts.stage ? (
          <Group gap={8} wrap="nowrap">
            <Text fz="lg" fw={500} lh="normal" data-parity="stage">
              {facts.stage}
            </Text>
            {facts.elapsed ? (
              <Text fz="md" lh="normal" c="dimmed" data-parity="elapsed">
                {facts.elapsed}
              </Text>
            ) : null}
            {facts.field ? (
              <Text fz="md" lh="normal" c="dimmed" truncate data-parity="field">
                · {facts.field}
              </Text>
            ) : null}
          </Group>
        ) : null}
      </div>
      <Stack gap={10} w="100%">
        <Divider />
        <div className={classes.footer} data-parity="footer">
          {facts.mr ? (
            <Group gap={5} wrap="nowrap">
              <Icon
                name="gitPullRequest"
                size={13}
                data-parity="git-pull-request"
              />
              <Text fz="md" lh="normal" c="dimmed" data-parity="mr text">
                {facts.mr}
              </Text>
            </Group>
          ) : null}
          <Group gap={5} wrap="nowrap">
            <Icon name="signpost" size={13} data-parity="signpost" />
            <Text fz="md" lh="normal" c="dimmed" data-parity="decisions">
              {facts.decisions}
            </Text>
          </Group>
          <span className={classes.spacer} />
          <Text fz="md" lh="normal" c="dimmed" data-parity="age">
            {facts.age}
          </Text>
        </div>
      </Stack>
    </Paper>
  );
}
