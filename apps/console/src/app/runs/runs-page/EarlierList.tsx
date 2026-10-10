import { Fragment, useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Paper,
  Text,
  ThemeIcon,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RunSummary } from '@mattstack/rt-client';
import { Link } from 'wouter';

import { formatClock } from '../derive/clock';
import { formatDuration } from '../derive/duration';
import {
  earlierPage,
  isStale,
  outcomeTile,
  rowDuration,
  rowEnd,
  rowSub,
  type DayGroup,
} from '../derive/lanes';
import classes from './EarlierList.module.css';

export interface EarlierRowInfo {
  ticket: string | null;
  title: string;
  href: string;
  /** A review or respond gate of this run waits on you in the board. */
  inBoard: boolean;
  /** "ages out in 2 days", when the pruner is close. */
  aging: string | null;
}

export interface EarlierListProps {
  groups: DayGroup[];
  info: (run: RunSummary) => EarlierRowInfo;
  now: number;
  /** Show 7 days at a time, with a row that adds 7 more. */
  paged?: boolean;
}

const PAGE_DAYS = 7;

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
  return (
    <Link
      href={info.href}
      className={classes.row}
      data-parity="Row"
      data-testid={`run-row-${run.id}`}
      data-stale={stale ? 'true' : undefined}
    >
      <ThemeIcon
        variant={tile.tone === 'gray' ? 'quiet' : 'light'}
        color={tile.tone}
        size={28}
        radius="md"
        className={classes.tile}
        data-tone={tile.tone}
        data-parity="outcome"
      >
        <Icon name={tile.icon} size={14} data-parity={tile.layer} />
      </ThemeIcon>
      <div className={classes.title}>
        <Group gap={8} wrap="nowrap" className={classes.line}>
          {info.ticket ? (
            <Text
              fz="lg"
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
            fz="lg"
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
        <Text fz="md" lh="normal" c="dimmed" truncate data-parity="sub">
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
        <Text
          fz="md"
          lh="normal"
          c="dimmed"
          className={classes.duration}
          data-parity="duration"
        >
          {formatDuration(rowDuration(run, now))}
        </Text>
        <Text
          fz="md"
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
export function EarlierList({
  groups,
  info,
  now,
  paged = false,
}: EarlierListProps) {
  const [days, setDays] = useState(PAGE_DAYS);
  const { shown, more } = paged
    ? earlierPage(groups, days)
    : { shown: groups, more: false };
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.history}
      data-parity="History"
      data-testid="earlier"
    >
      {shown.map(group => (
        <Fragment key={group.key}>
          <div className={classes.day} data-parity="Day">
            <Text fz="sm" fw={500} lh="normal" c="dimmed" data-parity="label">
              {group.label}
            </Text>
          </div>
          {group.runs.map(run => (
            <EarlierRow key={run.id} run={run} info={info(run)} now={now} />
          ))}
        </Fragment>
      ))}
      {more ? (
        <Button
          variant="subtle"
          fullWidth
          radius={0}
          rightSection={<Icon name="chevronDown" size={14} data-parity="i" />}
          onClick={() => setDays(d => d + PAGE_DAYS)}
        >
          <span data-parity="t">Show earlier days</span>
        </Button>
      ) : null}
    </Paper>
  );
}
