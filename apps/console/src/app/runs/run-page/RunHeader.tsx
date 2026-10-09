import { Fragment, useState, type FormEvent } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Menu,
  Paper,
  Stack,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { Icon, type IconName } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQueryClient } from '@tanstack/react-query';

import { client } from '../../api';
import type { HeroLiveness } from '../derive/liveness';
import type { RailStage } from '../derive/stages';
import { readApiError } from '../useRuns';
import { Dot } from './Dot';
import classes from './RunHeader.module.css';
import { StageRail } from './StageRail';

export interface RunHeaderProps {
  repo: string;
  runId: string;
  /** The ticket id, or `!<iid>` for the MR a review or respond run read. */
  ticket: string | null;
  ticketUrl: string | null;
  /** "work pipeline · started 1:38 PM · 2h 43m". */
  meta: string;
  title: string;
  liveness: HeroLiveness;
  /** Null for a run kind with no rail. */
  rail: RailStage[] | null;
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

/** The hero's ticket line (ticket, meta) over the run's title. */
export function HeroTitle({
  ticket,
  ticketUrl,
  meta,
  title,
}: {
  ticket: string | null;
  ticketUrl: string | null;
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

/** Why marking abandoned failed, or null once it worked. */
type AbandonResult = string | null;

const ABANDON_MODAL = 'run-abandon';

/** The abandon dialog's body: the reason, an inline error that keeps the
    reason when rt refuses, and Cancel beside the red confirm. */
function AbandonForm({
  submit,
  onCancel,
}: {
  submit: (reason: string) => Promise<AbandonResult>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    const failure = await submit(reason.trim());
    setBusy(false);
    setError(failure);
  };

  return (
    <form onSubmit={e => void onSubmit(e)}>
      <Stack gap={14}>
        <Text fz={13} lh={1.55} c="dimmed" data-parity="p">
          Use this when the agent is gone and the run will never finish.
          It&apos;s the same as rt runs abandon in the terminal.
        </Text>
        <TextInput
          data-autofocus
          label="Why is this run dead?"
          placeholder="wedged overnight, no owning process"
          value={reason}
          disabled={busy}
          onChange={e => {
            setReason(e.currentTarget.value);
            setError(null);
          }}
          attributes={{
            label: { 'data-parity': 'l' },
            input: { 'data-parity': 'input' },
          }}
        />
        {error ? (
          <Group gap={6} wrap="nowrap" role="alert" data-parity="err">
            <Icon
              name="circleAlert"
              size={14}
              color="var(--tk-text-bad-vivid)"
              data-parity="i"
            />
            <Text fz={12.5} lh="normal" c="bad" data-parity="t">
              Couldn&apos;t mark it: {error}. Nothing changed.
            </Text>
          </Group>
        ) : null}
        <Group gap={8} justify="flex-end">
          <Button variant="default" onClick={onCancel} data-parity="btn Cancel">
            <span data-parity="l">Cancel</span>
          </Button>
          <Button
            type="submit"
            color="bad"
            loading={busy}
            disabled={!reason.trim()}
            data-parity="btn Mark abandoned"
          >
            <span data-parity="l">Mark abandoned</span>
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

interface RunAction {
  label: string;
  icon: IconName;
  onClick: () => void;
  danger?: boolean;
}

/** The hero's run actions: a "..." menu when there are two or more, else the
    one action as its own button. */
function RunActions({ actions }: { actions: RunAction[] }) {
  if (actions.length === 0) return null;
  if (actions.length === 1) {
    const [only] = actions as [RunAction];
    return (
      <Button
        variant="default"
        color={only.danger ? 'bad' : undefined}
        leftSection={<Icon name={only.icon} size={14} />}
        onClick={only.onClick}
        data-parity={`btn ${only.label}`}
      >
        {only.label}
      </Button>
    );
  }
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="default"
          size="lg"
          aria-label="more run actions"
          data-parity="Btn more"
        >
          <Icon name="moreHorizontal" size={14} data-parity="ellipsis" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {actions.map(action => (
          <Fragment key={action.label}>
            {action.danger ? <Menu.Divider /> : null}
            <Menu.Item
              color={action.danger ? 'bad' : undefined}
              leftSection={<Icon name={action.icon} size={14} />}
              onClick={action.onClick}
              data-parity={`btn ${action.label}`}
            >
              {action.label}
            </Menu.Item>
          </Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** The run page's hero: ticket, title, liveness, actions and the stage
    rail. */
export function RunHeader({
  repo,
  runId,
  ticket,
  ticketUrl,
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

  const markAbandoned = async (reason: string): Promise<AbandonResult> => {
    try {
      const res = await client.api.runs[':repo'][':runId'].abandon.$post({
        param: { repo, runId },
        json: { reason },
      });
      if (!res.ok)
        return (
          await readApiError(res, 'rt refused the change')
        ).message.replace(/\.$/, '');
    } catch {
      return "the console server didn't answer";
    }
    modals.close(ABANDON_MODAL);
    await queryClient.invalidateQueries({ queryKey: ['run', repo, runId] });
    await queryClient.invalidateQueries({ queryKey: ['runs'] });
    return null;
  };

  const abandon = () =>
    modals.open({
      modalId: ABANDON_MODAL,
      title: (
        <Text span fz={16} fw={700} lh="normal" data-parity="t">
          {`Mark ${ticket ?? runId} abandoned?`}
        </Text>
      ),
      attributes: {
        inner: { 'data-parity': 'Abandon dialog' },
        content: { 'data-parity': 'dialog' },
      },
      children: (
        <AbandonForm
          submit={markAbandoned}
          onCancel={() => modals.close(ABANDON_MODAL)}
        />
      ),
    });

  const actions: RunAction[] = [
    ...(canResume && !resumed
      ? [
          {
            label: 'Resume',
            icon: 'rotateCcw' as const,
            onClick: () => void resume(),
          },
        ]
      : []),
    { label: 'View inputs', icon: 'layers', onClick: onViewInputs },
    ...(canAbandon
      ? [
          {
            label: 'Mark abandoned',
            icon: 'warning' as const,
            onClick: abandon,
            danger: true,
          },
        ]
      : []),
  ];

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
            <RunActions actions={actions} />
          </Group>
        </Group>
        {rail ? <StageRail stages={rail} finished={finished} /> : null}
      </Stack>
    </Paper>
  );
}
