import { useMemo, useState } from 'react';

import { formatNumber } from '../../../shared/metrics';
import type { EvidenceRow } from '../../../shared/types';
import { waitBins } from '../../model/evidence-shapes';
import { useGrow, type Grow } from '../../ui/useGrow';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvFooter, EvHead } from './parts';
import { WaitHistogram } from './WaitHistogram';

const FIRST_ROWS = 6;
const TRACK_W = 160;
const SLOW_HOURS = 24;

const hoursOf = (row: EvidenceRow): number =>
  Number.parseFloat(row.cells[2] ?? '') || 0;

/** Log scale, so a week-long wait does not flatten every other bar. */
const logWidth = (h: number, max: number): number =>
  max > 0 ? (TRACK_W * Math.log10(h + 1)) / Math.log10(max + 1) : 0;

function WaitRow({
  row,
  max,
  grow,
}: {
  row: EvidenceRow;
  max: number;
  grow: Grow;
}) {
  const [id, title, value] = row.cells;
  const h = hoursOf(row);
  const slow = h > SLOW_HOURS;
  return (
    <div
      className={`${classes.band} ${panels.waitRow}`}
      data-parity={`Wait Row ${id}`}
    >
      {row.href ? (
        <a
          className={`${classes.t} ${classes.num} ${classes.id} ${panels.waitId}`}
          data-parity="id"
          href={row.href}
          target="_blank"
          rel="noreferrer"
        >
          {id}
        </a>
      ) : (
        <span
          className={`${classes.t} ${classes.num} ${classes.id} ${panels.waitId}`}
          data-parity="id"
        >
          {id}
        </span>
      )}
      <span className={`${classes.t} ${panels.waitTitle}`} data-parity="title">
        {title}
      </span>
      <span className={panels.waitTrack} data-parity="Track">
        <span
          className={`${panels.waitBar} ${grow.className}`}
          data-parity="Bar"
          style={{
            ...grow.style,
            width: logWidth(h, max),
            background: slow ? 'var(--tk-dot-warn)' : 'var(--tk-muted)',
          }}
        />
      </span>
      <span
        className={`${classes.t} ${classes.num} ${panels.waitValue}`}
        data-parity="h"
        style={{ color: slow ? 'var(--tk-text-warn)' : 'var(--tk-text-3)' }}
      >
        {value}
      </span>
    </div>
  );
}

export function LatencyEvidence({ ev, statKey }: EvidenceProps) {
  const [all, setAll] = useState(false);
  const response = statKey === 'responseLatencyHours';
  const bins = useMemo(() => waitBins(ev), [ev]);
  const grow = useGrow();
  const slowest = useMemo(
    () => [...ev.rows].sort((a, b) => hoursOf(b) - hoursOf(a)),
    [ev.rows]
  );
  if (ev.rows.length === 0) return <EmptyEvidence />;
  const total = slowest.length;
  const shown = all ? slowest : slowest.slice(0, FIRST_ROWS);
  const max = hoursOf(slowest[0]!);
  const count = formatNumber(ev.facts?.count ?? total);
  return (
    <>
      <EvHead
        title="Distribution"
        right={
          response
            ? `${count} MRs, first response time`
            : `${count} MRs, first review wait`
        }
      />
      <WaitHistogram bins={bins} />
      <EvHead
        title={response ? 'Slowest responses' : 'Slowest waits'}
        right={
          response
            ? 'sorted by response time, longest first'
            : 'sorted by wait, longest first'
        }
      />
      {shown.map((row, i) => (
        <WaitRow key={row.cells[0]} row={row} max={max} grow={grow('x', i)} />
      ))}
      <EvFooter
        count={`Showing ${shown.length} of ${total} · bars on a log scale`}
        total={total}
        all={all}
        onToggle={total > FIRST_ROWS ? () => setAll(!all) : undefined}
      />
    </>
  );
}
