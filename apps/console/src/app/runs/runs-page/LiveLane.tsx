import { ActionIcon, Badge, Group, Paper, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';
import { Link } from 'wouter';

import { client } from '../../api';
import type { LaneFacts } from '../derive/lanes';
import { Dot } from '../run-page/Dot';
import { StageRail } from '../run-page/StageRail';
import classes from './LiveLane.module.css';

export interface LiveLaneProps {
  runId: string;
  ticket: string | null;
  title: string;
  href: string;
  facts: LaneFacts;
}

async function focusPane(pane: string) {
  try {
    const res = await client.api.panes[':id'].focus.$post({
      param: { id: pane },
    });
    if (!res.ok) notifications.error("couldn't focus the pane");
  } catch {
    notifications.error("couldn't focus the pane");
  }
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
          <Text
            component={Link}
            href={href}
            fz={13}
            fw={700}
            lh="normal"
            c="accent"
            className={classes.link}
            data-parity="ticket"
          >
            {ticket}
          </Text>
        ) : null}
        <span className={classes.spacer} />
        <Badge
          variant="light"
          color={liveness.tone}
          radius="xl"
          tt="none"
          leftSection={<Dot tone={liveness.tone} data-parity="dot" />}
          data-parity="Chip liveness"
        >
          <span data-parity="label">{liveness.label}</span>
        </Badge>
        {pane ? (
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
        ) : null}
      </Group>
      <Text
        component={Link}
        href={href}
        fz={15}
        fw={500}
        lh="normal"
        c="var(--tk-text-1)"
        className={`${classes.full} ${classes.link}`}
        data-parity="title"
      >
        {title}
      </Text>
      <div className={classes.now}>
        {facts.rail ? (
          <StageRail stages={facts.rail} gateCounts={{}} compact />
        ) : null}
        {facts.stage ? (
          <Group gap={8} wrap="nowrap">
            <Text fz={13} fw={500} lh="normal" data-parity="stage">
              {facts.stage}
            </Text>
            {facts.elapsed ? (
              <Text fz={12} lh="normal" c="dimmed" data-parity="elapsed">
                {facts.elapsed}
              </Text>
            ) : null}
            {facts.field ? (
              <Text fz={12} lh="normal" c="dimmed" truncate data-parity="field">
                · {facts.field}
              </Text>
            ) : null}
          </Group>
        ) : null}
      </div>
      <div className={classes.footer} data-parity="footer">
        {facts.mr ? (
          <Group gap={5} wrap="nowrap">
            <Icon
              name="gitPullRequest"
              size={13}
              data-parity="git-pull-request"
            />
            <Text fz={12} lh="normal" c="dimmed" data-parity="mr text">
              {facts.mr}
            </Text>
          </Group>
        ) : null}
        <Group gap={5} wrap="nowrap">
          <Icon name="signpost" size={13} data-parity="signpost" />
          <Text fz={12} lh="normal" c="dimmed" data-parity="decisions">
            {facts.decisions}
          </Text>
        </Group>
        <span className={classes.spacer} />
        <Text fz={12} lh="normal" c="dimmed" data-parity="age">
          {facts.age}
        </Text>
      </div>
    </Paper>
  );
}
