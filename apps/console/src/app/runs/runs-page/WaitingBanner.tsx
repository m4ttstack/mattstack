import { Button, Group, Kbd, Stack, Text } from '@mattstack/app-kit/core';
import { useHotkeys } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateRow } from '@mattstack/rt-client';
import { Link } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { formatDuration } from '../derive/duration';
import { gateName } from '../derive/gates';
import { Glyph } from '../Glyph';
import { StatusCard } from '../StatusCard';
import classes from './WaitingBanner.module.css';

export interface WaitingBannerProps {
  gate: GateRow;
  ticket: string | null;
  title: string;
  /** The run page, at the gate's panel. */
  href: string;
  now: number;
}

/** My oldest waiting gate, read-only: the run and its first question.
    "Answer gate" and `g` open the run page at the gate; nothing is answered
    here, so the options stay on the run page. */
export function WaitingBanner({
  gate,
  ticket,
  title,
  href,
  now,
}: WaitingBannerProps) {
  useHotkeys([['g', () => navigate(href)]]);
  const question = gate.questions[0];
  const count = gate.questions.length;

  return (
    <StatusCard
      tone="bad"
      attention="bad"
      head={
        <>
          <Glyph name="hand" size={14} color="bad" data-parity="hand" />
          <Text fz="sm" fw={500} lh="normal" c="bad" data-parity="title">
            Waiting on you
          </Text>
          <Text fz="sm" lh="normal" c="bad" data-parity="gate">
            · {gateName(gate.kind)}
            {count > 1 ? ` · ${count} questions` : ''} · opened{' '}
            {formatDuration(now - gate.openedAt)} ago
          </Text>
          <Group
            gap={6}
            wrap="nowrap"
            ml="auto"
            data-testid="key-hint"
            data-parity="hint"
          >
            <Text fz="xs" lh="normal" c="bad">
              press
            </Text>
            <Kbd size="xs" data-parity="key g">
              <span data-parity="g">g</span>
            </Kbd>
            <Text fz="xs" lh="normal" c="bad">
              to answer
            </Text>
          </Group>
        </>
      }
      headProps={{ 'data-parity': 'Header' }}
      data-parity="Banner waiting"
      data-testid="waiting-banner"
      data-gate-id={gate.id}
    >
      <div className={classes.body}>
        <Stack gap={4} className={classes.left}>
          <Group gap={8} wrap="nowrap">
            {ticket ? (
              <Text
                fz="sm"
                fw={500}
                lh="normal"
                c="accent"
                data-parity="ticket"
              >
                {ticket}
              </Text>
            ) : null}
            <Text fz="sm" lh="normal" c="dimmed" truncate data-parity="title">
              {title}
            </Text>
          </Group>
          {question ? (
            <Text fz="lg" fw={500} lh={1.45} data-parity="q">
              {question.label}
            </Text>
          ) : null}
        </Stack>
        <Button
          component={Link}
          href={href}
          size="sm"
          className={classes.right}
          rightSection={
            <Icon name="arrowRight" size={14} data-parity="arrow-right" />
          }
          data-parity="Answer btn"
        >
          <span data-parity="label">Answer gate</span>
        </Button>
      </div>
    </StatusCard>
  );
}
