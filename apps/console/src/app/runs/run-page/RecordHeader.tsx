import { Fragment } from 'react';
import { Divider, Group, Paper, Stack, Text } from '@mattstack/app-kit/core';
import type { RunOutcome } from '@mattstack/rt-client';

import type { RecordStat, RecordStatId } from '../derive/record';
import { Stat } from '../Stat';
import { OutcomeBadge } from './OutcomeBadge';
import classes from './RecordHeader.module.css';
import { HeroTitle } from './RunHeader';
import { FactsStrip, type FactProps } from './SideCards';

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
  /** An abandoned run's quoted reason, under the card, when recorded. */
  abandoned?: string | null;
  /** The run's links, along the foot of the card. */
  facts?: FactProps[];
}

/** A finished run's hero: ticket, span and title, how it ended, and the
    numbers that apply to it; an abandoned run's reason under it. */
export function RecordHeader({
  ticket,
  ticketUrl,
  meta,
  title,
  outcome,
  stats,
  abandoned = null,
  facts = [],
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
      <Stack gap={14}>
        <Group gap={16} wrap="nowrap" align="flex-start">
          <HeroTitle
            ticket={ticket}
            ticketUrl={ticketUrl}
            meta={meta}
            title={title}
          />
          {outcome ? <OutcomeBadge outcome={outcome} /> : null}
        </Group>
        <Divider />
        <div className={classes.stats} data-parity="Key numbers">
          {/* The first cell draws no rule, so the boards key its text
              straight through it. */}
          {stats.map((s, i) => (
            <Fragment key={s.id}>
              {i > 0 ? <Divider orientation="vertical" /> : null}
              <Stat
                value={s.value}
                label={s.label}
                size="h2"
                className={classes.stat}
                data-stat={s.id}
                data-parity={i > 0 ? STAT_LAYER[s.id] : undefined}
              />
            </Fragment>
          ))}
        </div>
        {facts.length ? (
          <>
            <Divider />
            <FactsStrip facts={facts} />
          </>
        ) : null}
      </Stack>
    </Paper>
  );
  if (!abandoned) return hero;
  return (
    <Stack gap={10}>
      {hero}
      <Text
        fz="lg"
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
