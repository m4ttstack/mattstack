import { useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Kbd,
  Menu,
  Paper,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQueryClient } from '@tanstack/react-query';

import { client } from '../../api';
import type { HeroLiveness } from '../derive/liveness';
import type { RailStage } from '../derive/stages';
import { Dot } from './Dot';
import inline from './inline.module.css';
import classes from './RunHeader.module.css';
import { StageRail } from './StageRail';

export interface RunHeaderProps {
  repo: string;
  runId: string;
  /** The ticket id, or `!<iid>` for the MR a review or respond run read. */
  ticket: string | null;
  ticketUrl: string | null;
  /** The `t` hotkey copies a ticket; an MR reference has none. */
  ticketHotkey: boolean;
  /** "work pipeline · started 1:38 PM · 2h 43m". */
  meta: string;
  title: string;
  liveness: HeroLiveness;
  /** Null for a run kind with no rail. */
  rail: { stages: RailStage[]; gateCounts: Record<string, number> } | null;
  finished: boolean;
  focusPane: string | null;
  canResume: boolean;
  canAbandon: boolean;
  onViewInputs: () => void;
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

/** The hero's ticket line (ticket, its `t` hint, meta) over the run's
    title. */
export function HeroTitle({
  ticket,
  ticketUrl,
  hotkey,
  meta,
  title,
}: {
  ticket: string | null;
  ticketUrl: string | null;
  hotkey: boolean;
  meta: string;
  title: string;
}) {
  return (
    <Stack gap={8} className={classes.title}>
      <Group gap={8} wrap="nowrap">
        {ticket ? (
          ticketUrl ? (
            <Anchor
              href={ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              fz={13}
              fw={700}
              lh="normal"
              c="accent"
              className={classes.keep}
              data-testid="ticket-link"
            >
              <Group gap={8} wrap="nowrap" component="span">
                <span data-parity="ticket">{ticket}</span>
                <Icon
                  name="externalLink"
                  size={12}
                  data-parity="external-link"
                />
              </Group>
            </Anchor>
          ) : (
            <Text
              fz={13}
              fw={700}
              lh="normal"
              c="accent"
              className={classes.keep}
              data-parity="ticket"
            >
              {ticket}
            </Text>
          )
        ) : null}
        {ticket && hotkey ? (
          <Kbd size="xs" className={inline.kbd} data-parity="kbd t">
            <span data-parity="t">t</span>
          </Kbd>
        ) : null}
        <Text fz={12.5} lh="normal" c="dimmed" truncate data-parity="meta">
          {ticket ? `· ${meta}` : meta}
        </Text>
      </Group>
      <Text fz={22} fw={700} lh="normal" data-parity="title">
        {title}
      </Text>
    </Stack>
  );
}

/** The run page's hero: ticket, title, liveness, actions and the stage
    rail. */
export function RunHeader({
  repo,
  runId,
  ticket,
  ticketUrl,
  ticketHotkey,
  meta,
  title,
  liveness,
  rail,
  finished,
  focusPane: pane,
  canResume,
  canAbandon,
  onViewInputs,
}: RunHeaderProps) {
  const queryClient = useQueryClient();
  const [resumed, setResumed] = useState(false);

  const resume = async () => {
    try {
      const res = await client.api.runs[':repo'][':runId'].resume.$post({
        param: { repo, runId },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        notifications.error(body?.error ?? "couldn't resume the run");
        return;
      }
      setResumed(true);
      notifications.success('Resumed the run in a new pane');
      await queryClient.invalidateQueries({ queryKey: ['run', repo, runId] });
    } catch {
      notifications.error("couldn't resume the run");
    }
  };

  const abandon = () =>
    modals.prompt({
      title: 'Mark run abandoned',
      message:
        'rt records the run as abandoned so the database stops claiming it is ' +
        'still going. Same as `rt runs abandon <id>` from the terminal.',
      label: 'Why is this run dead?',
      placeholder: 'wedged overnight, no owning process',
      required: true,
      confirmLabel: 'Mark abandoned',
      confirmProps: { color: 'bad' },
      onSubmit: async reason => {
        try {
          const res = await client.api.runs[':repo'][':runId'].abandon.$post({
            param: { repo, runId },
            json: { reason },
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            notifications.error(body?.error ?? "couldn't abandon the run");
            return;
          }
        } catch {
          notifications.error("couldn't abandon the run");
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ['run', repo, runId] });
        await queryClient.invalidateQueries({ queryKey: ['runs'] });
      },
    });

  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.hero}
      data-testid="run-header"
      data-parity="Hero"
    >
      <Stack gap={18}>
        <Group gap={16} wrap="nowrap" align="flex-start">
          <HeroTitle
            ticket={ticket}
            ticketUrl={ticketUrl}
            hotkey={ticketHotkey}
            meta={meta}
            title={title}
          />
          <Group gap={8} wrap="nowrap">
            <Badge
              size="lg"
              radius="xl"
              variant="light"
              color={liveness.tone}
              tt="none"
              leftSection={<Dot tone={liveness.tone} data-parity="dot" />}
              data-testid="liveness"
              data-parity="Chip liveness"
            >
              <span data-parity="label">{liveness.label}</span>
            </Badge>
            {pane ? (
              <Button
                leftSection={
                  <Icon
                    name="squareTerminal"
                    size={14}
                    data-parity="square-terminal"
                  />
                }
                onClick={() => void focusPane(pane)}
                aria-label="focus pane"
                data-parity="Btn Focus pane"
              >
                <span data-parity="Focus pane">Focus pane</span>
              </Button>
            ) : null}
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="default"
                  size="lg"
                  aria-label="more run actions"
                  data-parity="Btn more"
                >
                  <Icon
                    name="moreHorizontal"
                    size={14}
                    data-parity="ellipsis"
                  />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {canResume && !resumed ? (
                  <Menu.Item
                    leftSection={<Icon name="rotateCcw" size={14} />}
                    onClick={() => void resume()}
                  >
                    Resume
                  </Menu.Item>
                ) : null}
                <Menu.Item
                  leftSection={<Icon name="layers" size={14} />}
                  onClick={onViewInputs}
                >
                  View inputs
                </Menu.Item>
                {canAbandon ? (
                  <>
                    <Menu.Divider />
                    <Menu.Item
                      color="bad"
                      leftSection={<Icon name="warning" size={14} />}
                      onClick={abandon}
                    >
                      Mark abandoned
                    </Menu.Item>
                  </>
                ) : null}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
        {rail ? (
          <StageRail
            stages={rail.stages}
            gateCounts={rail.gateCounts}
            finished={finished}
          />
        ) : null}
      </Stack>
    </Paper>
  );
}
