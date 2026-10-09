import { useState, type CSSProperties } from 'react';
import { Group, Loader, Paper, Popover, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Link } from 'wouter';

import {
  barDetail,
  barLabel,
  barPlacement,
  LEGEND,
  type Bar,
  type DayAxis,
  type DayRow,
} from '../derive/day';
import { formatDuration } from '../derive/duration';
import type { SegmentKind } from '../derive/timeline';
import classes from './DayTimeline.module.css';
import { runHref, ticketOf } from './runLinks';

const at = (x: number) => ({ '--x': x }) as CSSProperties;

/** The five kinds a bar can be, as swatches. */
export function TimelineLegend() {
  return (
    <div className={classes.legend} data-parity="Legend">
      {LEGEND.map(item => (
        <div key={item.kind} className={classes.legendItem}>
          <span
            className={classes.swatch}
            data-kind={item.kind}
            data-parity="sw"
          />
          <Text fz={12} lh="normal" c="dimmed" data-parity="label">
            {item.label}
          </Text>
        </div>
      ))}
    </div>
  );
}

function Axis({ axis }: { axis: DayAxis }) {
  const span = axis.to - axis.from;
  return (
    <div className={classes.axis} data-parity="Axis">
      <div className={classes.label} />
      <div className={classes.ticks}>
        {axis.ticks.map(tick => (
          <Text
            key={tick.layer}
            fz={11}
            lh="normal"
            c="dimmed"
            className={classes.tick}
            data-end={tick.end || undefined}
            style={at((tick.at - axis.from) / span)}
            data-parity={tick.layer}
          >
            {tick.label}
          </Text>
        ))}
        {axis.now != null ? (
          <Text
            fz={11}
            fw={700}
            lh="normal"
            c="accent"
            className={classes.nowLabel}
            style={at((axis.now - axis.from) / span)}
            data-parity="now"
          >
            now
          </Text>
        ) : null}
      </div>
    </div>
  );
}

const TITLE_COLOR: Record<SegmentKind, string> = {
  done: 'ok',
  running: 'accent',
  you: 'bad',
  ci: 'warn',
  held: 'dimmed',
  idle: 'dimmed',
};

/** One bar, with a card on hover or focus naming its stage, its span and,
    for a waiting stretch, the gate and its pick. */
function BarSegment({ bar, axis }: { bar: Bar; axis: DayAxis }) {
  const [opened, setOpened] = useState(false);
  const { x, w } = barPlacement(bar, axis);
  const detail = barDetail(bar);
  const open = () => setOpened(true);
  const close = () => setOpened(false);
  return (
    <Popover opened={opened} position="bottom" offset={8} width={300}>
      <Popover.Target>
        <div
          tabIndex={0}
          role="img"
          aria-label={barLabel(bar)}
          className={classes.seg}
          data-kind={bar.kind}
          style={{ '--x': x, '--w': w } as CSSProperties}
          data-parity="seg"
          data-testid="timeline-bar"
          onMouseEnter={open}
          onMouseLeave={close}
          onFocus={open}
          onBlur={close}
        />
      </Popover.Target>
      <Popover.Dropdown
        className={classes.barCard}
        data-parity="hover card"
        data-testid="bar-card"
      >
        <Text
          fz={13}
          fw={700}
          lh="normal"
          c={TITLE_COLOR[bar.kind]}
          data-parity="h"
        >
          {detail.title}
        </Text>
        <Text fz={12} lh="normal" c="dimmed" data-parity="a">
          {detail.span}
        </Text>
        {detail.gate ? (
          <Text fz={12.5} lh="18px" data-parity="q">
            {`Gate: ${detail.gate}`}
          </Text>
        ) : null}
      </Popover.Dropdown>
    </Popover>
  );
}

function Lane({
  row,
  title,
  axis,
}: {
  row: DayRow;
  title: string;
  axis: DayAxis;
}) {
  const ticket = ticketOf(row.run);
  const href = runHref(row.run);
  return (
    <div
      className={classes.lane}
      data-parity="Lane"
      data-testid={`timeline-row-${row.run.id}`}
    >
      <div className={classes.label}>
        <Group gap={8} wrap="nowrap" className={classes.line}>
          {ticket ? (
            <Text
              component={Link}
              href={href}
              fz={12.5}
              fw={700}
              lh="normal"
              c="accent"
              className={`${classes.keep} ${classes.ticket}`}
              data-parity="ticket"
            >
              {ticket}
            </Text>
          ) : null}
          <Text fz={12.5} fw={500} lh="normal" truncate data-parity="title">
            {title}
          </Text>
        </Group>
        <Text
          fz={11.5}
          fw={row.sub.waiting ? 500 : 400}
          lh="normal"
          c={row.sub.waiting ? 'bad' : 'dimmed'}
          truncate
          data-parity="sub"
        >
          {row.sub.text}
        </Text>
      </div>
      <div className={classes.track}>
        <div className={classes.base} data-parity="base" />
        {row.bars.map(bar => (
          <BarSegment key={bar.from} bar={bar} axis={axis} />
        ))}
        {axis.now != null ? (
          <div
            className={classes.nowLine}
            style={at(barPlacement({ from: axis.now, to: axis.now }, axis).x)}
            data-parity="now line"
          />
        ) : null}
      </div>
    </div>
  );
}

export interface DayTimelineProps {
  rows: DayRow[];
  axis: DayAxis;
  /** Time spent waiting on you across the rows. */
  youMs: number;
  isToday: boolean;
  /** The day's runs or their stages have not landed yet. */
  loading: boolean;
  titleOf: (row: DayRow) => string;
}

/** One row of stage bars per run active on the day, on one time axis. */
export function DayTimeline({
  rows,
  axis,
  youMs,
  isToday,
  loading,
  titleOf,
}: DayTimelineProps) {
  const when = isToday ? 'today' : 'that day';
  const waited = youMs > 0 ? formatDuration(youMs) : 'none';
  return (
    <Paper
      variant="ground"
      withBorder
      radius={12}
      className={classes.card}
      data-parity="Timeline card"
      data-testid="day-timeline"
    >
      <Axis axis={axis} />
      {rows.length === 0 && loading ? (
        <div className={classes.empty} data-testid="timeline-loading">
          <Group gap={8} wrap="nowrap">
            <Loader size="xs" />
            <Text fz={13} lh="normal" c="dimmed">
              Loading the day's runs…
            </Text>
          </Group>
        </div>
      ) : rows.length > 0 ? (
        rows.map(row => (
          <Lane key={row.run.id} row={row} title={titleOf(row)} axis={axis} />
        ))
      ) : (
        <div className={classes.empty}>
          <Text fz={13} lh="normal" c="dimmed">
            {`No runs were active ${when}.`}
          </Text>
        </div>
      )}
      <div className={classes.hint} data-parity="Hint">
        <Icon
          name="info"
          size={13}
          color="var(--tk-text-3)"
          data-parity="info"
        />
        <Text fz={12} lh="normal" c="dimmed" data-parity="hint">
          {loading
            ? 'Hover a bar for the stage and its gate.'
            : `Hover a bar for the stage and its gate. A red stretch is time a run sat waiting for you: ${waited} ${when}.`}
        </Text>
      </div>
    </Paper>
  );
}
