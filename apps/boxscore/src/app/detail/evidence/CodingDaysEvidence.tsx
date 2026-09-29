import { useMemo } from 'react';

import { formatNumber } from '../../../shared/metrics';
import { calendarWeeks, type CalendarDay } from '../../model/evidence-shapes';
import { dayLabel } from '../../model/labels';
import { PushCalendar } from '../../ui/PushCalendar';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EvHead } from './parts';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const weekday = (d: CalendarDay): number =>
  new Date(`${d.date}T00:00:00Z`).getUTCDay();
const named = (d: CalendarDay): string =>
  `${WEEKDAYS[weekday(d)]} ${dayLabel(d.date)}`;
const month = (d: CalendarDay): string => dayLabel(d.date).split(' ')[0]!;
const dayOfMonth = (d: CalendarDay): string => dayLabel(d.date).split(' ')[1]!;

export function busiestDay(days: CalendarDay[]): string {
  let best: CalendarDay | undefined;
  for (const d of days) if (d.count > (best?.count ?? 0)) best = d;
  if (!best) return 'None';
  return `${named(best)} · ${formatNumber(best.count)} ${best.count === 1 ? 'push' : 'pushes'}`;
}

/** A range repeats its month only when the month changes from the range before it. */
function ranges(runs: CalendarDay[][]): string {
  let lastMonth = '';
  return runs
    .map(run => {
      const first = run[0]!;
      const last = run.at(-1)!;
      const start =
        month(first) === lastMonth ? dayOfMonth(first) : dayLabel(first.date);
      lastMonth = month(first);
      if (run.length === 1) return start;
      const end =
        month(last) === month(first) ? dayOfMonth(last) : dayLabel(last.date);
      return `${start} – ${end}`;
    })
    .join(', ');
}

export function longestRun(days: CalendarDay[]): string {
  const runs: CalendarDay[][] = [];
  let current: CalendarDay[] = [];
  for (const d of days) {
    if (d.count > 0) current.push(d);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  const length = Math.max(0, ...runs.map(r => r.length));
  if (length === 0) return 'None';
  const longest = runs.filter(r => r.length === length);
  const times =
    longest.length === 1
      ? ''
      : longest.length === 2
        ? ', twice'
        : `, ${longest.length} times`;
  return `${length} ${length === 1 ? 'day' : 'days'}${times} (${ranges(longest)})`;
}

export function quietWeekdays(days: CalendarDay[]): string {
  const quiet = days.filter(d => d.count === 0 && weekday(d) % 6 !== 0);
  return quiet.length ? quiet.map(named).join(', ') : 'None';
}

const LEGEND: { name: string; background: string; opacity?: number }[] = [
  { name: 'l0', background: 'var(--tk-raised)' },
  { name: 'l0.35', background: 'var(--tk-fill-gold)', opacity: 0.35 },
  { name: 'l0.65', background: 'var(--tk-fill-gold)', opacity: 0.65 },
  { name: 'l1', background: 'var(--tk-fill-gold)' },
];

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={panels.fact}>
      <span className={`${classes.t} ${panels.factLabel}`} data-parity="fl">
        {label}
      </span>
      <span className={`${classes.t} ${panels.factValue}`} data-parity="fv">
        {value}
      </span>
    </div>
  );
}

export function CodingDaysEvidence({ ev, window }: EvidenceProps) {
  const weeks = useMemo(
    () => calendarWeeks(ev, window.start, window.end),
    [ev, window.start, window.end]
  );
  const days = weeks.flat().filter(d => d.inWindow);
  const first = days[0];
  const last = days.at(-1);
  const span =
    first && last ? `${dayLabel(first.date)} – ${dayLabel(last.date)}, ` : '';
  return (
    <>
      <EvHead title="Push calendar" right={`${span}pushes per day`} />
      <div className={`${classes.block} ${panels.calendar}`}>
        <PushCalendar weeks={weeks} />
        <div className={panels.calFacts}>
          <Fact label="Busiest day" value={busiestDay(days)} />
          <Fact label="Longest run" value={longestRun(days)} />
          <Fact label="Weekdays without a push" value={quietWeekdays(days)} />
          <div className={panels.legend}>
            <span
              className={`${classes.t} ${panels.legendWord}`}
              data-parity="a"
            >
              Fewer
            </span>
            {LEGEND.map(l => (
              <span
                key={l.name}
                className={panels.legendSwatch}
                data-parity={l.name}
                style={{ background: l.background, opacity: l.opacity }}
              />
            ))}
            <span
              className={`${classes.t} ${panels.legendWord}`}
              data-parity="b"
            >
              More
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
