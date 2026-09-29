import { useMemo, useState } from 'react';

import type { EvidenceRow } from '../../../shared/types';
import { dayLabel } from '../../model/labels';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvFooter, MrId } from './parts';

export type MergedSort = 'newest' | 'most-added' | 'most-deleted';

const SORTS: { key: MergedSort; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'most-added', label: 'Most added' },
  { key: 'most-deleted', label: 'Most deleted' },
];

const FIRST_ROWS = 6;
const BLOCKS = 5;

const lines = (cell: string | undefined): number =>
  Number.parseInt((cell ?? '').replace(/[^0-9]/g, ''), 10) || 0;
const added = (r: EvidenceRow) => lines(r.cells[2]);
const deleted = (r: EvidenceRow) => lines(r.cells[3]);
const merged = (r: EvidenceRow) => r.cells[4] ?? '';

/** Stable sorts, so rows that tie keep the server's highest-MR-first order. */
const ORDER: Record<MergedSort, (a: EvidenceRow, b: EvidenceRow) => number> = {
  newest: (a, b) => merged(b).localeCompare(merged(a)),
  'most-added': (a, b) => added(b) - added(a),
  'most-deleted': (a, b) => deleted(b) - deleted(a),
};

function DiffBlocks({ a, d }: { a: number; d: number }) {
  const total = a + d;
  const ok = total > 0 ? Math.round((a / total) * BLOCKS) : 0;
  return (
    <span className={panels.blocks}>
      {Array.from({ length: BLOCKS }, (_, i) => (
        <span
          key={i}
          className={panels.block}
          data-parity="b"
          style={{
            background:
              total === 0
                ? 'var(--tk-raised)'
                : i < ok
                  ? 'var(--tk-fill-ok)'
                  : 'var(--tk-fill-bad)',
          }}
        />
      ))}
    </span>
  );
}

function MergedRow({ row }: { row: EvidenceRow }) {
  const [id = '', title, add, del, day] = row.cells;
  return (
    <div className={`${classes.band} ${panels.row}`} data-parity={`MR ${id}`}>
      <MrId id={id} href={row.href} />
      <span className={`${classes.t} ${panels.rowTitle}`} data-parity="title">
        {title}
      </span>
      <span className={panels.diff}>
        <span
          className={`${classes.t} ${classes.num} ${panels.diffAdd}`}
          data-parity="a"
        >
          {add}
        </span>
        <span
          className={`${classes.t} ${classes.num} ${panels.diffDel}`}
          data-parity="d"
        >
          {del}
        </span>
        <DiffBlocks a={added(row)} d={deleted(row)} />
      </span>
      <span
        className={`${classes.t} ${classes.num} ${panels.mergedOn}`}
        data-parity="dt"
      >
        {day ? dayLabel(day) : ''}
      </span>
    </div>
  );
}

export function MergedMrsEvidence({
  ev,
  initialSort = 'newest',
}: EvidenceProps & { initialSort?: MergedSort }) {
  const [sort, setSort] = useState(initialSort);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => [...ev.rows].sort(ORDER[sort]), [ev.rows, sort]);
  if (ev.rows.length === 0) return <EmptyEvidence />;
  const total = sorted.length;
  const shown = all ? sorted : sorted.slice(0, FIRST_ROWS);
  return (
    <>
      <div className={panels.sortTabs} data-parity="Sort Tabs">
        <span className={`${classes.t} ${classes.barTitle}`} data-parity="t">
          Merged MRs
        </span>
        <span className={panels.spacer} />
        <div
          role="tablist"
          aria-label="Sort merged MRs"
          className={panels.tabs}
        >
          {SORTS.map(s => {
            const active = s.key === sort;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={panels.tab}
                data-parity={active ? `Sort ${s.label}` : undefined}
                style={{ background: active ? 'var(--tk-raised)' : undefined }}
                onClick={() => setSort(s.key)}
              >
                <span
                  className={`${classes.t} ${panels.tabLabel}`}
                  data-parity="l"
                  style={{
                    color: active ? 'var(--tk-text-1)' : 'var(--tk-text-3)',
                  }}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {shown.map(row => (
        <MergedRow key={row.cells[0]} row={row} />
      ))}
      <EvFooter
        count={`Showing ${shown.length} of ${total}`}
        total={total}
        all={all}
        onToggle={total > FIRST_ROWS ? () => setAll(!all) : undefined}
      />
    </>
  );
}
