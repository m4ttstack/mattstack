import {
  Badge,
  Button,
  Group,
  Kbd,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useHotkeys } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateRow } from '@mattstack/rt-client';
import { Link } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { formatDuration } from '../derive/duration';
import { optionViews } from '../derive/gates';
import inline from '../run-page/inline.module.css';
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
    <div
      className={classes.banner}
      data-parity="Banner waiting"
      data-testid="waiting-banner"
      data-gate-id={gate.id}
    >
      <div className={classes.head} data-parity="Header">
        <Icon
          name="hand"
          size={14}
          color="var(--tk-text-bad-vivid)"
          data-parity="hand"
        />
        <Text fz={12} fw={700} lh="normal" c="bad" data-parity="title">
          Waiting on you
        </Text>
        <Text fz={12} lh="normal" c="bad" data-parity="gate">
          {gateName(gate.kind)} · opened {formatDuration(now - gate.openedAt)}{' '}
          ago
        </Text>
        <span className={classes.spacer} />
        <Text fz={11} lh="normal" c="bad" ff="monospace" data-parity="hint">
          press g to jump
        </Text>
      </div>
      <div className={classes.body}>
        <Stack gap={6} className={classes.left}>
          <Group gap={8} wrap="nowrap">
            {ticket ? (
              <Text
                fz={14}
                fw={700}
                lh="normal"
                c="accent"
                data-parity="ticket"
              >
                {ticket}
              </Text>
            ) : null}
            <Text fz={14} fw={500} lh="normal" truncate data-parity="title">
              {title}
            </Text>
          </Group>
          {question ? (
            <>
              <Text fz={15} fw={500} lh="normal" data-parity="q">
                {question.label}
              </Text>
              <Group gap={8}>
                {optionViews(question).map((o, i) => (
                  <Badge
                    key={o.value}
                    size="lg"
                    variant={o.recommended ? 'light' : 'default'}
                    color={o.recommended ? 'accent' : undefined}
                    tt="none"
                    className={classes.chip}
                    leftSection={
                      i < 9 ? (
                        <Kbd size="xs" className={inline.kbd} data-parity="kbd">
                          <span data-parity="k">{i + 1}</span>
                        </Kbd>
                      ) : undefined
                    }
                    rightSection={
                      o.recommended ? (
                        <Text
                          span
                          fz={10.5}
                          fw={500}
                          c="accent"
                          data-parity="rec"
                        >
                          recommended
                        </Text>
                      ) : undefined
                    }
                    data-option={o.value}
                    data-parity="opt"
                  >
                    <span data-parity="label">{o.text}</span>
                  </Badge>
                ))}
              </Group>
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
          {count > 1 ? (
            <Text fz={11.5} lh="normal" c="dimmed" data-parity="progress">
              1 of {count} questions
            </Text>
          ) : null}
        </Stack>
      </div>
    </div>
  );
}
