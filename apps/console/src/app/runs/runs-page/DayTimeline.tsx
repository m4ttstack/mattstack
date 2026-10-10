import {
  Fragment,
  type ComponentPropsWithRef,
  type CSSProperties,
} from 'react';
import {
  Anchor,
  Group,
  HoverCard,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
  useHoverCardContext,
} from '@mattstack/app-kit/core';
import { useGrow, useWindowEvent, type Grow } from '@mattstack/app-kit/hooks';
import { Link } from 'wouter';

import {
  barDetail,
  barLabel,
  barPlacement,
  isQuiet,
  LEGEND,
  type Bar,
  type DayAxis,
  type DayRow,
} from '../derive/day';
import { formatDuration } from '../derive/duration';
import type { SegmentKind } from '../derive/timeline';
import { Glyph } from '../Glyph';
import scrollFit from '../scrollFit.module.css';
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
          <Text fz="md" lh="normal" c="dimmed" data-parity="label">
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
            fz="sm"
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
            fz="sm"
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

/** Long enough that sweeping the pointer across a lane opens no card. */
const HOVER_OPEN_DELAY_MS = 200;

const TITLE_COLOR: Record<SegmentKind, string> = {
  done: 'ok',
  running: 'accent',
  you: 'bad',
  ci: 'warn',
  held: 'dimmed',
  idle: 'dimmed',
};

/** The bar itself. Hovering it opens its card through HoverCard; keyboard
    focus opens it the same way, and Escape closes it. */
function BarTarget({
  bar,
  share,
  ...target
}: ComponentPropsWithRef<'div'> & { bar: Bar; share: number }) {
  const card = useHoverCardContext();
  useWindowEvent('keydown', event => {
    if (event.key === 'Escape') card.closeDropdown();
  });
  return (
    <Progress.Section
      {...target}
      value={share}
      tabIndex={0}
      aria-label={barLabel(bar)}
      className={classes.seg}
      data-kind={bar.kind}
      data-parity="seg"
      data-testid="timeline-bar"
      onFocus={card.openDropdown}
      onBlur={card.closeDropdown}
    />
  );
}

/** One bar, with a card on hover or focus naming its stage, its span and,
    for a waiting stretch, the gate and its pick. */
function BarSegment({ bar, share }: { bar: Bar; share: number }) {
  const detail = barDetail(bar);
  return (
    <HoverCard
      openDelay={HOVER_OPEN_DELAY_MS}
      position="bottom"
      offset={8}
      width={300}
    >
      <HoverCard.Target>
        <BarTarget bar={bar} share={share} />
      </HoverCard.Target>
      <HoverCard.Dropdown
        className={classes.barCard}
        data-parity="hover card"
        data-testid="bar-card"
      >
        <Text
          fz="lg"
          fw={700}
          lh="normal"
          c={TITLE_COLOR[bar.kind]}
          data-parity="h"
        >
          {detail.title}
        </Text>
        <Text fz="md" lh="normal" c="dimmed" data-parity="a">
          {detail.span}
        </Text>
        {detail.gate ? (
          <Text fz="md" lh="18px" data-parity="q">
            {`Gate: ${detail.gate}`}
          </Text>
        ) : null}
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

/** A run's day as one rounded bar from its first active stretch to its
    last, each a section sized by its share, as boxscore draws a stacked
    bar. Idle and held time between them stays empty, and a run with only
    quiet time that day draws no bar. Too short to see, the bar keeps a
    minimum length (see .runBar). */
function RunBar({
  bars,
  axis,
  grow,
}: {
  bars: Bar[];
  axis: DayAxis;
  grow: Grow;
}) {
  const active = bars.filter(bar => !isQuiet(bar));
  const first = active[0];
  const last = active[active.length - 1];
  if (!first || !last) return null;
  const span = last.to - first.from || 1;
  const { x, w } = barPlacement({ from: first.from, to: last.to }, axis);
  const share = (ms: number) => (ms / span) * 100;
  return (
    <Progress.Root
      size={10}
      radius="xl"
      className={`${classes.runBar} ${grow.className}`}
      // A run that carries on past an edge of the frame ends square there.
      data-cut-start={first.from <= axis.from || undefined}
      data-cut-end={last.to >= axis.to || undefined}
      style={{ '--x': x, '--w': w, ...grow.style } as CSSProperties}
      data-parity="run bar"
    >
      {active.map((bar, i) => {
        const gap = i > 0 ? bar.from - active[i - 1]!.to : 0;
        return (
          <Fragment key={bar.from}>
            {gap > 0 ? (
              <Progress.Section value={share(gap)} color="transparent" />
            ) : null}
            <BarSegment bar={bar} share={share(bar.to - bar.from)} />
          </Fragment>
        );
      })}
    </Progress.Root>
  );
}

function Lane({
  row,
  title,
  axis,
  index,
}: {
  row: DayRow;
  title: string;
  axis: DayAxis;
  /** The lane's place down the card, which staggers its bars' grow-in. */
  index: number;
}) {
  const grow = useGrow();
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
            <Anchor
              component={Link}
              href={href}
              fz="md"
              fw={700}
              lh="normal"
              className={classes.keep}
              data-parity="ticket"
            >
              {ticket}
            </Anchor>
          ) : null}
          <Text fz="md" fw={500} lh="normal" truncate data-parity="title">
            {title}
          </Text>
        </Group>
        <Text
          fz="sm"
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
        <RunBar bars={row.bars} axis={axis} grow={grow('x', index)} />
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
  /** How tall the lanes may grow before they scroll under the axis. */
  lanesMaxHeight?: number | string;
}

/** One row of stage bars per run active on the day, on one time axis. */
export function DayTimeline({
  rows,
  axis,
  youMs,
  isToday,
  loading,
  titleOf,
  lanesMaxHeight = 784,
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
            <Loader size="sm" />
            <Text fz="lg" lh="normal" c="dimmed">
              Loading the day's runs…
            </Text>
          </Group>
        </div>
      ) : rows.length > 0 ? (
        // The lanes scroll under the axis once a busy day outgrows the card.
        <ScrollArea.Autosize
          mah={lanesMaxHeight}
          type="auto"
          scrollbars="y"
          classNames={{ root: scrollFit.root, content: scrollFit.content }}
        >
          {rows.map((row, i) => (
            <Lane
              key={row.run.id}
              row={row}
              title={titleOf(row)}
              axis={axis}
              index={i}
            />
          ))}
        </ScrollArea.Autosize>
      ) : (
        <div className={classes.empty} data-testid="timeline-empty">
          <Stack gap={6} align="center">
            <Glyph name="calendar" size={20} color="dimmed" />
            <Text fz="lg" fw={500} lh="normal">
              {`No runs were active ${when}.`}
            </Text>
            <Text fz="md" lh="normal" c="dimmed">
              Pick another day in the calendar.
            </Text>
          </Stack>
        </div>
      )}
      <div className={classes.hint} data-parity="Hint">
        <Glyph name="info" size={13} color="dimmed" data-parity="info" />
        <Text fz="md" lh="normal" c="dimmed" data-parity="hint">
          {loading
            ? 'Hover a bar for the stage and its gate.'
            : `Hover a bar for the stage and its gate. A red stretch is time a run sat waiting for you: ${waited} ${when}.`}
        </Text>
      </div>
    </Paper>
  );
}
