import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { GateRow } from '@mattstack/rt-client';

import { contextSchema, structuredContextSummary } from '../derive/answers';
import { formatDuration } from '../derive/duration';
import { gateKindLabel, optionViews } from '../derive/gates';
import { OptionChips } from '../OptionChips';
import { StatusCard } from '../StatusCard';
import { Dot } from './Dot';
import classes from './HandoffCard.module.css';
import inline from './inline.module.css';

export interface HandoffCardProps {
  gate: GateRow;
  /** The board's page for this gate, or null when the console has none. */
  boardUrl: string | null;
  /** The clock "opened ... ago" reads against. */
  now?: number;
}

function webUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function summaryLines(gate: GateRow): string[] {
  const contexts = [gate.context, ...gate.questions.map(q => q.context)];
  const lines: string[] = [];
  for (const context of contexts) {
    const summary = structuredContextSummary(context);
    if (!summary) continue;
    const schema = contextSchema(context);
    lines.push(schema ? `${schema} · ${summary}` : summary);
  }
  return lines;
}

/** What a review or respond run shows where a gate panel would go: those
    gates are answered in the board, so this is read-only. It names the gate,
    lays out the questions and their options, summarises the structured
    context and points at the board. */
export function HandoffCard({
  gate,
  boardUrl,
  now = Date.now(),
}: HandoffCardProps) {
  const href = webUrl(boardUrl);
  const summaries = summaryLines(gate);

  return (
    <StatusCard
      tone="warn"
      head={
        <>
          <Dot tone="warn" size="md" data-parity="live" />
          <Text fz="md" fw={700} lh="normal" c="warn" data-parity="title">
            {gateKindLabel(gate.kind)} · waiting in the board
          </Text>
          <Text fz="md" lh="normal" c="warn" ml="auto" data-parity="times">
            opened {formatDuration(now - gate.openedAt)} ago
          </Text>
        </>
      }
      headProps={{ 'data-parity': 'Now head' }}
      data-gate-id={gate.id}
      data-parity="Now"
    >
      <Stack gap={10} className={classes.body}>
        {gate.questions.map(q => (
          <Stack key={q.id} gap={10} data-question={q.id}>
            <Text fz="lg" fw={500} lh="normal" data-parity="q">
              {q.label}
            </Text>
            <OptionChips options={optionViews(q)} />
          </Stack>
        ))}
        {summaries.map(line => (
          <Group key={line} gap={6} wrap="nowrap" data-summary>
            <Icon name="braces" size={14} data-parity="braces" />
            <Text fz="md" lh="normal" c="dimmed" data-parity="s">
              {line}
            </Text>
          </Group>
        ))}
        <Group justify="flex-end">
          {href ? (
            <Button
              className={inline.control}
              component="a"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              rightSection={
                <Icon name="arrowRight" size={14} data-parity="arrow" />
              }
              data-parity="Btn answer in board"
            >
              <span data-parity="l">Answer in the board</span>
            </Button>
          ) : (
            <Text size="sm" c="dimmed">
              Answer in the board
            </Text>
          )}
        </Group>
      </Stack>
    </StatusCard>
  );
}
