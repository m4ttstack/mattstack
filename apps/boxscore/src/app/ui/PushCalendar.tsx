import type { CSSProperties } from 'react';

import type { CalendarDay } from '../model/evidence-shapes';
import classes from './ui.module.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const LEVEL_OPACITY = [1, 0.35, 0.65, 1] as const;

function monthDay(date: string): [number, number] {
  const [, m, d] = date.split('-').map(Number);
  return [m!, d!];
}

function dayStyle(day: CalendarDay): CSSProperties {
  if (!day.inWindow) {
    return { outline: '1px solid var(--tk-border-soft)', outlineOffset: -0.5 };
  }
  if (day.level === 0) return { background: 'var(--tk-raised)' };
  return {
    background: 'var(--tk-fill-gold)',
    opacity: LEVEL_OPACITY[day.level],
  };
}

export function PushCalendar({
  weeks,
  parity,
}: {
  weeks: CalendarDay[][];
  parity?: string;
}) {
  return (
    <div className={classes.calendar} data-parity={parity}>
      <div className={`${classes.calRow} ${classes.dow}`}>
        {WEEKDAYS.map(d => (
          <span
            key={d}
            className={`${classes.text} ${classes.dowLabel}`}
            data-parity={d}
          >
            {d}
          </span>
        ))}
      </div>
      {weeks.map(week => {
        const first = week[0];
        if (!first) return null;
        const [m, d] = monthDay(first.date);
        return (
          <div key={first.date} className={classes.calRow}>
            <span
              className={`${classes.text} ${classes.weekLabel}`}
              data-parity="wk"
            >
              {`${MONTHS[m - 1]} ${d}`}
            </span>
            {week.map(day => {
              const [dm, dd] = monthDay(day.date);
              return (
                <div
                  key={day.date}
                  className={classes.day}
                  data-parity={`Day ${dm}-${dd}`}
                  style={dayStyle(day)}
                >
                  {day.inWindow && day.level === 3 ? (
                    <span
                      className={`${classes.num} ${classes.text} ${classes.dayCount}`}
                      data-parity="n"
                    >
                      {day.count}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
