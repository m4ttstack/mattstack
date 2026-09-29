import type { EvidenceRow } from '../../../shared/types';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import {
  EmptyEvidence,
  EvidenceBar,
  EvidenceFooter,
  HeaderRow,
  useEvidenceRows,
} from './parts';

const COLUMNS: { label: string; width?: number }[] = [
  { label: 'Issue', width: 92 },
  { label: 'Title' },
  { label: 'State', width: 150 },
  { label: 'Closed', width: 100 },
  { label: 'MR(s)', width: 120 },
];

const cellStyle = (width?: number) =>
  width === undefined ? undefined : { width };

function StateBadge({ state }: { state: string }) {
  const done = state.toLowerCase() === 'done';
  return (
    <span
      className={classes.badge}
      data-parity="State Badge"
      style={{
        background: done
          ? 'var(--mantine-color-ok-light)'
          : 'var(--mantine-color-accent-light)',
      }}
    >
      <span
        className={classes.badgeDot}
        data-parity="dot"
        style={{
          background: done ? 'var(--tk-dot-ok)' : 'var(--tk-fill-accent)',
        }}
      />
      <span
        className={`${classes.t} ${classes.badgeText}`}
        data-parity="st"
        style={{
          color: done
            ? 'var(--tk-text-ok-small)'
            : 'var(--tk-text-accent-small)',
        }}
      >
        {state}
      </span>
    </span>
  );
}

function MrCell({ row }: { row: EvidenceRow }) {
  const ids = row.cells[4]!.split(', ').filter(id => id !== '—');
  const [first, ...rest] = ids;
  const href = row.mrHrefs?.[0];
  return (
    <span
      className={`${classes.t} ${classes.num} ${classes.mr}`}
      data-parity="v"
      title={ids.length > 1 ? ids.join(', ') : undefined}
    >
      {first === undefined ? (
        '—'
      ) : href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {first}
        </a>
      ) : (
        first
      )}
      {rest.length > 0 ? ` +${rest.length}` : null}
    </span>
  );
}

function IssueRow({ row }: { row: EvidenceRow }) {
  const [id, title, state, closed] = row.cells;
  return (
    <div className={classes.row} data-parity={`Ev Row ${id}`} role="row">
      <span className={classes.cell} style={cellStyle(92)} role="cell">
        {row.href ? (
          <a
            className={`${classes.t} ${classes.num} ${classes.id}`}
            data-parity="id"
            href={row.href}
            target="_blank"
            rel="noreferrer"
          >
            {id}
          </a>
        ) : (
          <span
            className={`${classes.t} ${classes.num} ${classes.id}`}
            data-parity="id"
          >
            {id}
          </span>
        )}
      </span>
      <span className={`${classes.cell} ${classes.grow}`} role="cell">
        <span className={classes.title} data-parity="title">
          {title}
        </span>
      </span>
      <span className={classes.cell} style={cellStyle(150)} role="cell">
        <StateBadge state={state ?? '—'} />
      </span>
      <span className={classes.cell} style={cellStyle(100)} role="cell">
        <span
          className={`${classes.t} ${classes.num} ${classes.closed}`}
          data-parity="v"
        >
          {closed}
        </span>
      </span>
      <span className={classes.cell} style={cellStyle(120)} role="cell">
        <MrCell row={row} />
      </span>
    </div>
  );
}

export function IssuesEvidence({ ev }: EvidenceProps) {
  const { query, setQuery, all, setAll, filtered, shown } = useEvidenceRows(
    ev.rows
  );
  if (ev.rows.length === 0) return <EmptyEvidence />;
  return (
    <>
      <EvidenceBar
        placeholder={`Filter ${ev.rows.length} issues`}
        query={query}
        onQuery={setQuery}
      />
      <div role="table" aria-label="Issues">
        <HeaderRow>
          {COLUMNS.map(c => (
            <span
              key={c.label}
              className={`${classes.cell} ${c.width === undefined ? classes.grow : ''}`}
              style={cellStyle(c.width)}
              role="columnheader"
            >
              <span className={`${classes.t} ${classes.h}`} data-parity="h">
                {c.label}
              </span>
            </span>
          ))}
        </HeaderRow>
        {shown.map(row => (
          <IssueRow key={row.cells[0]} row={row} />
        ))}
      </div>
      <EvidenceFooter
        shown={shown.length}
        total={filtered.length}
        all={all}
        onToggle={() => setAll(!all)}
      />
    </>
  );
}
