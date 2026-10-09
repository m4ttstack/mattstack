import { Group, Paper, Stack, Text } from '@mattstack/app-kit/core';
import type { RunOutcome } from '@mattstack/rt-client';

import type { RecordStat, RecordStatId } from '../derive/record';
import { OutcomeBadge } from './OutcomeBadge';
import classes from './RecordHeader.module.css';
import { HeroTitle } from './RunHeader';

/** The boards name each stat cell by its role. */
const STAT_LAYER: Record<RecordStatId, string> = {
  duration: 'Stat duration',
  decisions: 'Stat decisions',
  took: 'Stat took',
  waiting: 'Stat waiting',
};

export interface RecordHeaderProps {
  ticket: string | null;
  ticketUrl: string | null;
  /** "work pipeline · Oct 8, 11:42 AM → 2:14 PM". */
  meta: string;
  title: string;
  outcome: RunOutcome | undefined;
  stats: RecordStat[];
  /** "Abandoned · <when> · “<reason>”", under the card, when recorded. */
  abandoned?: string | null;
}

/** A finished run's hero: ticket, span and title, how it ended, and the
    numbers that apply to it; an abandoned run's when and why under it. */
export function RecordHeader({
  ticket,
  ticketUrl,
  meta,
  title,
  outcome,
  stats,
  abandoned = null,
}: RecordHeaderProps) {
  const hero = (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.hero}
      data-testid="record-header"
      data-parity="Hero"
    >
      <Stack gap={16}>
        <Group gap={16} wrap="nowrap" align="flex-start">
          <HeroTitle
            ticket={ticket}
            ticketUrl={ticketUrl}
            meta={meta}
            title={title}
          />
          {outcome ? <OutcomeBadge outcome={outcome} /> : null}
        </Group>
        <div className={classes.stats} data-parity="Key numbers">
          {/* The first cell draws no rule, so the boards key its text
              straight through it. */}
          {stats.map((s, i) => (
            <div
              key={s.id}
              className={classes.stat}
              data-stat={s.id}
              data-parity={i > 0 ? STAT_LAYER[s.id] : undefined}
            >
              <Text fz={19} fw={700} lh="normal" data-parity="value">
                {s.value}
              </Text>
              <Text fz={12} lh="normal" c="dimmed" data-parity="label">
                {s.label}
              </Text>
            </div>
          ))}
        </div>
      </Stack>
    </Paper>
  );
  if (!abandoned) return hero;
  return (
    <Stack gap={10}>
      {hero}
      <Text
        fz={13}
        lh="normal"
        c="dimmed"
        className={classes.abandoned}
        data-testid="abandoned-line"
      >
        {abandoned}
      </Text>
    </Stack>
  );
}
