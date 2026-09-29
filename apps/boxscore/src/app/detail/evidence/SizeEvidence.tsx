import { useMemo, useState } from 'react';

import { formatNumber } from '../../../shared/metrics';
import type { EvidenceRow } from '../../../shared/types';
import { sizeBins } from '../../model/evidence-shapes';
import { BinHistogram, type HistBin } from './BinHistogram';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvFooter, EvHead, MrId } from './parts';

const FIRST_ROWS = 3;

const changed = (r: EvidenceRow): number => Number(r.cells[2]) || 0;
const iid = (r: EvidenceRow): number =>
  Number((r.cells[0] ?? '').replace(/[^0-9]/g, '')) || 0;

export function SizeEvidence({ ev }: EvidenceProps) {
  const [all, setAll] = useState(false);
  const bins = useMemo<HistBin[]>(
    () =>
      sizeBins(ev).map(b => ({
        name: b.label,
        label: b.label,
        count: b.count,
        background: b.highlight ? 'var(--mantine-color-ok-light)' : undefined,
        bar: b.highlight
          ? 'var(--tk-fill-ok)'
          : b.count > 0
            ? 'var(--tk-fill-warn)'
            : 'var(--tk-muted)',
        labelColor: b.highlight ? 'var(--tk-text-ok)' : 'var(--tk-text-3)',
      })),
    [ev]
  );
  const newest = useMemo(
    () => [...ev.rows].sort((a, b) => iid(b) - iid(a)),
    [ev.rows]
  );
  if (ev.rows.length === 0) return <EmptyEvidence />;
  const low = ev.facts?.bandLow ?? 0;
  const high = ev.facts?.bandHigh ?? 0;
  const outside = newest.filter(r => r.muted);
  const total = newest.length;
  const shown = all ? newest : outside.slice(0, FIRST_ROWS);
  return (
    <>
      <EvHead title="MR sizes" right="changed lines per merged MR" />
      <BinHistogram bins={bins} plotHeight={154} maxBar={100} inset={6} />
      <div className={panels.bandLegend}>
        <span
          className={panels.bandSwatch}
          data-parity="sw"
          style={{ background: 'var(--mantine-color-ok-light)' }}
        />
        <span className={`${classes.t} ${panels.legendText}`} data-parity="l">
          {`Healthy band, ${formatNumber(low)}–${formatNumber(high)} lines`}
        </span>
      </div>
      <EvHead
        title={all ? 'All merged MRs' : 'Outside the band'}
        right="newest first"
      />
      {shown.length === 0 && (
        <EmptyEvidence message="Every merged MR is inside the band" />
      )}
      {shown.map(row => (
        <div
          key={row.cells[0]}
          className={`${classes.band} ${panels.row}`}
          data-parity={`Sz ${row.cells[0]}`}
        >
          <MrId id={row.cells[0] ?? ''} href={row.href} />
          <span
            className={`${classes.t} ${panels.rowTitle}`}
            data-parity="title"
          >
            {row.cells[1]}
          </span>
          <span
            className={`${classes.t} ${classes.num} ${panels.sizeLines}`}
            data-parity="c"
            style={{
              color: row.muted ? 'var(--tk-text-warn)' : 'var(--tk-text-3)',
            }}
          >
            {`${formatNumber(changed(row))} lines`}
          </span>
        </div>
      ))}
      <EvFooter
        count={
          all
            ? `Showing ${total} of ${total}`
            : `Showing ${shown.length} of ${outside.length} outside the band`
        }
        total={total}
        all={all}
        onToggle={() => setAll(!all)}
      />
    </>
  );
}
