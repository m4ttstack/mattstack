import type { CSSProperties } from 'react';
import { UnstyledButton } from '@mantine/core';

import classes from './HeatCalendar.module.css';

export interface HeatCalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** 0 for none, 1 to 3 from a little to the most. */
  level: 0 | 1 | 2 | 3;
  /** Shown on the strongest days, and in the cell's accessible name. */
  count?: number;
  /** A day outside the period (padding a week, or still to come) draws as
      an empty frame and cannot be picked. */
  inWindow: boolean;
}

export interface HeatCalendarProps {
  /** Rows of seven days, Sunday first. */
  weeks: HeatCalendarDay[][];
  /** The kit hue the days fill with. @default 'gold' */
  hue?: 'accent' | 'ok' | 'bad' | 'warn' | 'purple' | 'cyan' | 'gold';
  /** The day that is open, ringed. */
  selected?: string | null;
  /** Makes each day in the period a button. */
  onPick?: (date: string) => void;
  /** Names a day for a screen reader, e.g. "Mon Oct 5, 3 runs". */
  dayLabel?: (day: HeatCalendarDay) => string;
  /** `top` writes the count on the strongest days only; `all` on every day
      that has one, quietly, in the hue's own shade. @default 'top' */
  showCounts?: 'top' | 'all';
}

/** A count in the day's own shade: the hue's text on the palest days, the
    on-fill colour (mixed a little toward the fill, so it stays quiet) on
    the two stronger ones, where the hue's text would sink into the fill.
    The open day keeps its fill (the fill is the data) and takes that same
    colour at full strength. */
const countColor = (hue: string, level: number, open: boolean) =>
  level >= 2
    ? open
      ? `var(--tk-on-fill-${hue})`
      : `color-mix(in srgb, var(--tk-on-fill-${hue}) 82%, var(--tk-fill-${hue}))`
    : open
      ? `var(--tk-text-${hue})`
      : `color-mix(in srgb, var(--tk-text-${hue}) 60%, transparent)`;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** How much of the hue's fill each level mixes into the surface. A mix,
    not an opacity, so a count inside keeps its own colour. */
const LEVEL_MIX = [0, 35, 65, 100] as const;

const monthDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });

function dayStyle(day: HeatCalendarDay, hue: string): CSSProperties {
  if (!day.inWindow) return {};
  if (day.level === 0) return { background: 'var(--tk-raised)' };
  return {
    background: `color-mix(in srgb, var(--tk-fill-${hue}) ${LEVEL_MIX[day.level]}%, var(--tk-raised))`,
  };
}

/**
 * A heat map of days, a week to a row, as boxscore's push calendar draws
 * it: each day's fill in a kit hue at one of three strengths, empty days on
 * the raised surface, days outside the period as empty frames. With
 * `onPick` each day in the period is a button that picks it.
 */
export function HeatCalendar({
  weeks,
  hue = 'gold',
  selected = null,
  onPick,
  dayLabel = day => monthDay(day.date),
  showCounts = 'top',
}: HeatCalendarProps) {
  return (
    <div
      className={classes.calendar}
      style={{ '--heat-fill': `var(--tk-fill-${hue})` } as CSSProperties}
    >
      <div className={classes.row} aria-hidden>
        <span />
        {WEEKDAYS.map(d => (
          <span key={d} className={classes.dowLabel}>
            {d}
          </span>
        ))}
      </div>
      {weeks.map(week => {
        const first = week[0];
        if (!first) return null;
        return (
          <div key={first.date} className={classes.row}>
            <span className={classes.weekLabel} aria-hidden>
              {monthDay(first.date)}
            </span>
            {week.map(day => {
              const style = dayStyle(day, hue);
              const shown =
                day.inWindow &&
                day.count != null &&
                day.count > 0 &&
                (showCounts === 'all' || day.level === 3);
              const count = shown ? (
                <span
                  className={classes.count}
                  style={{
                    color: countColor(hue, day.level, day.date === selected),
                  }}
                  aria-hidden
                >
                  {day.count}
                </span>
              ) : null;
              return onPick && day.inWindow ? (
                <UnstyledButton
                  key={day.date}
                  className={classes.day}
                  style={style}
                  data-selected={day.date === selected || undefined}
                  aria-label={dayLabel(day)}
                  aria-pressed={day.date === selected}
                  onClick={() => onPick(day.date)}
                >
                  {count}
                </UnstyledButton>
              ) : (
                <div
                  key={day.date}
                  className={classes.day}
                  style={style}
                  data-out={!day.inWindow || undefined}
                  data-selected={day.date === selected || undefined}
                >
                  {count}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
