import type { TimeWindow, UserRow } from '../../shared/types';
import { descriptor } from '../model/standings';
import { personSummary } from '../model/summary';
import classes from './detail.module.css';
import { windowDays } from './panelCopy';

function Cell({
  parity,
  label,
  value,
  unit,
  sub,
}: {
  parity?: string;
  label: string;
  value: string;
  unit: string;
  sub: string;
}) {
  return (
    <div
      className={`${classes.sumCell} ${parity ? classes.sumCellStroked : ''}`}
      data-parity={parity}
    >
      <span
        className={`${classes.t} ${classes.sumLabel}`}
        data-parity="Sum Label"
      >
        {label}
      </span>
      <div className={classes.sumVal}>
        <span
          className={`${classes.t} ${classes.num} ${classes.sumV}`}
          data-parity="V"
        >
          {value}
        </span>
        <span className={classes.sumUnitPad}>
          <span className={`${classes.t} ${classes.sumUnit}`} data-parity="U">
            {unit}
          </span>
        </span>
      </div>
      <span className={`${classes.t} ${classes.sumSub}`} data-parity="Sum Sub">
        {sub}
      </span>
    </div>
  );
}

export function PersonSummary({
  users,
  person,
  window,
}: {
  users: UserRow[];
  person: UserRow;
  window: TimeWindow;
}) {
  const s = personSummary(users, person.username);
  const rankedCount = users.filter(u => u.resolved).length;
  const m = person.metrics;
  return (
    <section
      className={classes.summary}
      data-parity="Summary"
      aria-label="Summary"
    >
      <Cell
        parity="Sum Leads"
        label="Leads"
        value={String(s.leads.length)}
        unit={s.leads.length === 1 ? 'stat' : 'stats'}
        sub={
          s.leads.length > 0
            ? s.leads.map(k => descriptor(k).label).join(', ')
            : 'none this window'
        }
      />
      <Cell
        parity="Sum Top 3"
        label="Top 3"
        value={String(s.top3)}
        unit={`of ${s.statCount}`}
        sub="stats this window"
      />
      <Cell
        parity="Sum Median rank"
        label="Median rank"
        value={s.medianRank === null ? '—' : `#${s.medianRank}`}
        unit={`of ${rankedCount}`}
        sub={`across all ${s.statCount} stats`}
      />
      <Cell
        label="Coding days"
        value={String(m.codingDays.value)}
        unit={`of ${windowDays(window)}`}
        sub={`streak ${m.currentStreak.value}d, best ${m.longestStreak.value}d`}
      />
    </section>
  );
}
