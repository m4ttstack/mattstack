import { Fragment } from 'react';
import { Badge, Group, Paper, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RunSummary } from '@mattstack/rt-client';
import { Link } from 'wouter';

import { formatClock } from '../derive/clock';
import { formatDuration } from '../derive/duration';
import {
  decisionsText,
  evidenceText,
  isStale,
  outcomeTile,
  rowDuration,
  rowEnd,
  rowSub,
  type DayGroup,
  type OutcomeTile,
} from '../derive/lanes';
import classes from './EarlierList.module.css';

const GLYPH: Record<OutcomeTile['tone'], string> = {
  ok: 'var(--tk-text-ok-vivid)',
  accent: 'var(--tk-text-accent-vivid)',
  bad: 'var(--tk-text-bad-vivid)',
  warn: 'var(--tk-text-warn-vivid)',
  gray: 'var(--tk-text-3)',
};

export interface EarlierRowInfo {
  ticket: string | null;
  title: string;
  href: string;
  decisions: number;
  /** A review or respond gate of this run waits on you in the board. */
  inBoard: boolean;
  /** "ages out in 2 days", when the pruner is close. */
  aging: string | null;
}

export interface EarlierListProps {
  groups: DayGroup[];
  info: (run: RunSummary) => EarlierRowInfo;
  now: number;
}

function EarlierRow({
  run,
  info,
  now,
}: {
  run: RunSummary;
  info: EarlierRowInfo;
  now: number;
}) {
  const tile = outcomeTile(run);
  const stale = isStale(run);
  const evidence = evidenceText(run);
  return (
    <Link
      href={info.href}
      className={classes.row}
      data-parity="Row"
      data-testid={`run-row-${run.id}`}
      data-stale={stale ? 'true' : undefined}
    >
      <span
        className={classes.tile}
        data-tone={tile.tone}
        data-parity="outcome"
      >
        <Icon
          name={tile.icon}
          size={14}
          color={GLYPH[tile.tone]}
          data-parity={tile.layer}
        />
      </span>
      <div className={classes.title}>
        <Group gap={8} wrap="nowrap" className={classes.line}>
          {info.ticket ? (
            <Text
              fz={13}
              fw={700}
              lh="normal"
              c={stale ? 'dimmed' : undefined}
              className={classes.keep}
              data-parity="ticket"
            >
              {info.ticket}
            </Text>
          ) : null}
          <Text
            fz={13}
            lh="normal"
            c={stale ? 'dimmed' : undefined}
            truncate
            data-parity="name"
          >
            {info.title}
          </Text>
          {info.inBoard ? (
            <Badge
              size="sm"
              variant="light"
              color="warn"
              tt="none"
              className={classes.keep}
              data-testid="waiting-in-board"
            >
              waiting in the board
            </Badge>
          ) : null}
        </Group>
        <Text fz={12} lh="normal" c="dimmed" truncate data-parity="sub">
          {rowSub(run)}
          {info.aging ? (
            <Text span inherit c="warn" data-testid="aging-warning">
              {' · '}
              {info.aging}
            </Text>
          ) : null}
        </Text>
      </div>
      <div className={classes.meta}>
        <Group gap={5} wrap="nowrap" className={classes.count}>
          <Icon name="signpost" size={13} data-parity="signpost" />
          <Text fz={12} lh="normal" c="dimmed" data-parity="decisions">
            {decisionsText(info.decisions)}
          </Text>
        </Group>
        <Group gap={5} wrap="nowrap" className={classes.count}>
          <Icon name="image" size={13} data-parity="image" />
          <Text fz={12} lh="normal" c="dimmed" data-parity="evidence">
            {evidence}
          </Text>
        </Group>
        <Text
          fz={12}
          lh="normal"
          c="dimmed"
          className={classes.duration}
          data-parity="duration"
        >
          {formatDuration(rowDuration(run, now))}
        </Text>
        <Text
          fz={12}
          lh="normal"
          c="dimmed"
          className={classes.end}
          data-parity="end"
        >
          {formatClock(rowEnd(run, now))}
        </Text>
        <Icon name="chevronRight" size={14} data-parity="chevron-right" />
      </div>
    </Link>
  );
}

/** Every run that is not a live lane, by the day it stopped. */
export function EarlierList({ groups, info, now }: EarlierListProps) {
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.history}
      data-parity="History"
      data-testid="earlier"
    >
      {groups.map(group => (
        <Fragment key={group.key}>
          <div className={classes.day} data-parity="Day">
            <Text fz={11.5} fw={500} lh="normal" c="dimmed" data-parity="label">
              {group.label}
            </Text>
          </div>
          {group.runs.map(run => (
            <EarlierRow key={run.id} run={run} info={info(run)} now={now} />
          ))}
        </Fragment>
      ))}
    </Paper>
  );
}
