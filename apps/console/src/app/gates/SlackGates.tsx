import { useEffect } from 'react';
import {
  Badge,
  Button,
  PageShell,
  Paper,
  Text,
  ThemeIcon,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearch } from 'wouter';

import {
  agedLabel,
  leftLabel,
  slackGateView,
  type SlackGateView,
} from '../../shared/slack-gate';
import { client } from '../api';
import { PAGE_ROW_HEIGHT } from '../chrome';
import { Eyebrow } from '../runs/Eyebrow';
import { RetryAlert } from '../runs/RetryAlert';
import { readApiError } from '../runs/useRuns';
import { clockTime } from '../usage/format';
import classes from './SlackGates.module.css';
import { SLACK_GATES_KEY, useSlackGates } from './useSlackGates';

type Decision = 'approve' | 'decline';

function originLine(view: SlackGateView, trigger: string): string | null {
  const origin = view.origin;
  if (!origin) return null;
  if (origin.from === 'teammate') return `Teammate asked with ${trigger}`;
  if (origin.from === 'pane') return `From pane ${origin.pane}`;
  return `From ${origin.handle}`;
}

function useAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
    }: {
      id: string;
      decision: Decision;
    }) => {
      const res = await client.api.gates[':id'].answer.$post({
        param: { id },
        json: { answers: { decision } },
      });
      if (!res.ok) throw await readApiError(res, 'answer failed');
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SLACK_GATES_KEY }),
  });
}

function GateRowItem({
  view,
  trigger,
  now,
  focused,
}: {
  view: SlackGateView;
  trigger: string;
  now: number;
  focused: boolean;
}) {
  const answer = useAnswer();
  const isNew = view.kind === 'new';
  const tone = isNew ? 'accent' : 'purple';
  const origin = originLine(view, trigger);
  const left = leftLabel(view.expiresAt, now);
  const pendingFor = answer.isPending ? answer.variables?.decision : undefined;

  useEffect(() => {
    if (focused)
      document
        .getElementById(`slack-gate-${view.id}`)
        ?.scrollIntoView?.({ block: 'center' });
  }, [focused, view.id]);

  return (
    <div
      id={`slack-gate-${view.id}`}
      className={classes.row}
      data-focused={focused || undefined}
      data-testid="slack-gate"
    >
      <ThemeIcon variant="light" color={tone} size={28} radius="md">
        <Icon name={isNew ? 'messageSquarePlus' : 'rotateCcw'} size={16} />
      </ThemeIcon>
      <div className={classes.body}>
        <div className={classes.who}>
          <Text fz="md" fw={500} lh="normal">
            {view.name}
          </Text>
          <Badge variant="light" color={tone} size="sm">
            {isNew ? 'New chat' : 'Resume'}
          </Badge>
        </div>
        {view.brief ? (
          <Text fz="md" lh="normal" lineClamp={2} className={classes.brief}>
            {view.brief}
          </Text>
        ) : null}
        {origin ? (
          <Text fz="sm" lh="normal" c="dimmed">
            {origin}
          </Text>
        ) : null}
      </div>
      <div className={classes.age}>
        <Text fz="sm" lh="normal" c="dimmed">
          {agedLabel(view.openedAt, now)}
        </Text>
        <Text
          fz="sm"
          lh="normal"
          c={left.urgent ? 'warn' : 'dimmed'}
          fw={left.urgent ? 500 : undefined}
        >
          {left.text}
        </Text>
      </div>
      <div className={classes.actions}>
        <Button
          variant="default"
          disabled={answer.isPending}
          loading={pendingFor === 'decline'}
          onClick={() => answer.mutate({ id: view.id, decision: 'decline' })}
        >
          Decline
        </Button>
        <Button
          disabled={answer.isPending}
          loading={pendingFor === 'approve'}
          onClick={() => answer.mutate({ id: view.id, decision: 'approve' })}
        >
          Approve
        </Button>
      </div>
      {answer.isError ? (
        <Text fz="sm" lh="normal" c="bad" className={classes.error}>
          {answer.error.message}
        </Text>
      ) : null}
    </div>
  );
}

export function SlackGates() {
  const slack = useSlackGates();
  const { now, trigger } = slack;
  const search = useSearch();
  const focusId = new URLSearchParams(search).get('gate');
  const views = slack.gates.map(slackGateView);

  return (
    <PageShell headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <PageShell.Main>
        <PageShell.Header
          title="Slack chats"
          actions={
            slack.loaded && slack.updatedAt ? (
              <Text fz="sm" c="dimmed" lh="normal">
                {`as of ${clockTime(slack.updatedAt)}`}
              </Text>
            ) : undefined
          }
        />
        <PageShell.Content
          contentContainerProps={{ maw: 1680, my: 0, px: 40, py: 28 }}
        >
          <div className={classes.page} data-testid="slack-gates-page">
            {slack.failed ? (
              <RetryAlert
                color="warn"
                icon="unplug"
                onRetry={() => void slack.refetch()}
              >
                Can&apos;t read chat requests.
              </RetryAlert>
            ) : null}
            {slack.loaded && trigger !== undefined ? (
              <>
                {views.length > 0 ? (
                  <Eyebrow>{`Waiting ${views.length}`}</Eyebrow>
                ) : null}
                <Paper
                  variant="ground"
                  withBorder
                  radius={12}
                  className={classes.card}
                >
                  {views.length > 0 ? (
                    views.map(view => (
                      <GateRowItem
                        key={view.id}
                        view={view}
                        trigger={trigger}
                        now={now}
                        focused={view.id === focusId}
                      />
                    ))
                  ) : (
                    <div className={classes.empty}>
                      <Text fz="lg" fw={500} lh="normal">
                        Nothing waiting
                      </Text>
                      <Text fz="md" lh="normal" c="dimmed">
                        Requests appear here
                      </Text>
                    </div>
                  )}
                </Paper>
              </>
            ) : null}
          </div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
