import { Button, Group, Kbd, Stack, Text } from '@mattstack/app-kit/core';
import { useHotkeys } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateRow } from '@mattstack/rt-client';
import { Link } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { formatDuration } from '../derive/duration';
import { optionViews } from '../derive/gates';
import { Glyph } from '../Glyph';
import { OptionChips } from '../OptionChips';
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

/** "plan gate" from a kind such as `plan` or `clarify:capture:1`. */
const gateName = (kind: string) =>
  `${kind.split(':')[0]!.replace(/-/g, ' ')} gate`;

/** My oldest waiting gate, read-only: the run, the first question and its
    numbered options. "Answer gate" and `g` open the run page at the gate;
    nothing is answered here. */
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
          <Text fz="md" fw={700} lh="normal" c="bad" data-parity="title">
            Waiting on you
          </Text>
          <Text fz="md" lh="normal" c="bad" data-parity="gate">
            {gateName(gate.kind)} · opened {formatDuration(now - gate.openedAt)}{' '}
            ago
          </Text>
        </>
      }
      headProps={{ 'data-parity': 'Header' }}
      data-parity="Banner waiting"
      data-testid="waiting-banner"
      data-gate-id={gate.id}
    >
      <div className={classes.body}>
        <Stack gap={6} className={classes.left}>
          <Group gap={8} wrap="nowrap">
            {ticket ? (
              <Text
                fz="lg"
                fw={700}
                lh="normal"
                c="accent"
                data-parity="ticket"
              >
                {ticket}
              </Text>
            ) : null}
            <Text fz="lg" fw={500} lh="normal" truncate data-parity="title">
              {title}
            </Text>
          </Group>
          {question ? (
            <>
              <Text fz="xl" fw={500} lh="normal" data-parity="q">
                {question.label}
              </Text>
              <OptionChips options={optionViews(question)} />
            </>
          ) : null}
        </Stack>
        <Stack gap={8} align="flex-end" className={classes.right}>
          <Button
            component={Link}
            href={href}
            rightSection={
              <Icon name="arrowRight" size={14} data-parity="arrow-right" />
            }
            data-parity="Answer btn"
          >
            <span data-parity="label">Answer gate</span>
          </Button>
          <Group gap={6} wrap="nowrap" data-testid="key-hint">
            <Text fz="md" lh="normal" c="dimmed" data-parity="or">
              {count > 1 ? `1 of ${count} questions · or press` : 'or press'}
            </Text>
            <Kbd size="sm" data-parity="key g">
              <span data-parity="g">g</span>
            </Kbd>
          </Group>
        </Stack>
      </div>
    </StatusCard>
  );
}
