import { useMemo, useState } from 'react';

import { formatNumber } from '../../../shared/metrics';
import type { EvidenceRow } from '../../../shared/types';
import { depthBins } from '../../model/evidence-shapes';
import { BinHistogram, type HistBin } from './BinHistogram';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvFooter, EvHead, MrId } from './parts';

const FIRST_ROWS = 3;
/** Ten pips fill the 90px column. */
const MAX_PIPS = 10;

const inline = (r: EvidenceRow): number => Number(r.cells[2]) || 0;

export function DepthEvidence({ ev }: EvidenceProps) {
  const [all, setAll] = useState(false);
  const bins = useMemo<HistBin[]>(
    () =>
      depthBins(ev).map(b => ({
        name: b.label,
        label: `${b.label} ${b.label === '1' ? 'comment' : 'comments'}`,
        count: b.count,
        bar: b.highlight ? 'var(--tk-fill-accent)' : 'var(--tk-muted)',
        labelColor: 'var(--tk-text-3)',
      })),
    [ev]
  );
  const deepest = useMemo(
    () => [...ev.rows].sort((a, b) => inline(b) - inline(a)),
    [ev.rows]
  );
  if (ev.rows.length === 0) return <EmptyEvidence />;
  const total = deepest.length;
  const shown = all ? deepest : deepest.slice(0, FIRST_ROWS);
  return (
    <>
      <EvHead title="Comments per MR" right="how deep each review went" />
      <BinHistogram bins={bins} plotHeight={134} maxBar={100} />
      <EvHead title="Deepest reviews" right="most inline comments first" />
      {shown.map(row => {
        const n = inline(row);
        return (
          <div
            key={row.cells[0]}
            className={`${classes.band} ${panels.row}`}
            data-parity={`Dp ${row.cells[0]}`}
          >
            <MrId id={row.cells[0] ?? ''} href={row.href} />
            <span className={`${classes.t} ${panels.rowTitle}`} data-parity="t">
              {row.cells[1]}
            </span>
            <span className={panels.pips}>
              {Array.from({ length: Math.min(n, MAX_PIPS) }, (_, i) => (
                <span key={i} className={panels.pip} data-parity="p" />
              ))}
            </span>
            <span
              className={`${classes.t} ${classes.num} ${panels.pipCount}`}
              data-parity="n"
            >
              {formatNumber(n)}
            </span>
          </div>
        );
      })}
      <EvFooter
        count={`Showing ${shown.length} of ${formatNumber(total)}`}
        total={total}
        all={all}
        onToggle={total > FIRST_ROWS ? () => setAll(!all) : undefined}
      />
    </>
  );
}
