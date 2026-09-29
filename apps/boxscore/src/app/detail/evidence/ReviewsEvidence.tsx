import { useMemo, useState } from 'react';

import { formatNumber } from '../../../shared/metrics';
import type { EvidenceRow } from '../../../shared/types';
import { reviewsByAuthor } from '../../model/evidence-shapes';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvFooter, EvHead, MrId } from './parts';

const FIRST_ROWS = 5;
/** Below this share of reviews a bar is too narrow to carry the handle, so it prints the count alone. */
const NAMED_SHARE = 0.08;

const HEADS: { label: string; className: string }[] = [
  { label: 'MR', className: classes.idCol },
  { label: 'Author', className: panels.rwAuthor },
  { label: 'Title', className: panels.fill },
  { label: 'Comments', className: panels.rwComments },
  { label: 'Inline', className: panels.rwInline },
];

function Count({
  value,
  name,
  className,
}: {
  value: string | undefined;
  name: string;
  className: string;
}) {
  return (
    <span
      className={`${classes.t} ${classes.num} ${className}`}
      data-parity={name}
      style={{
        color: Number(value) > 0 ? 'var(--tk-text-1)' : 'var(--tk-text-3)',
      }}
    >
      {value}
    </span>
  );
}

function ReviewRow({ row }: { row: EvidenceRow }) {
  const [id = '', author, title, comments, inline] = row.cells;
  return (
    <div className={`${classes.band} ${panels.row}`} data-parity={`Rw ${id}`}>
      <MrId id={id} href={row.href} />
      <span className={`${classes.t} ${panels.rwAuthor}`} data-parity="a">
        {`@${author}`}
      </span>
      <span className={`${classes.t} ${panels.rowTitle}`} data-parity="t">
        {title}
      </span>
      <Count value={comments} name="c" className={panels.rwComments} />
      <Count value={inline} name="i" className={panels.rwInline} />
    </div>
  );
}

export function ReviewsEvidence({ ev }: EvidenceProps) {
  const [all, setAll] = useState(false);
  const authors = useMemo(() => reviewsByAuthor(ev), [ev]);
  if (ev.rows.length === 0) return <EmptyEvidence />;
  const total = ev.rows.length;
  const shown = all ? ev.rows : ev.rows.slice(0, FIRST_ROWS);
  return (
    <>
      <EvHead title="By author" right="whose MRs you reviewed" />
      <div className={panels.authors}>
        {authors.map(a => {
          const named = a.count / total >= NAMED_SHARE;
          const label = named
            ? `@${a.author} · ${formatNumber(a.count)}`
            : formatNumber(a.count);
          return (
            <div
              key={a.author}
              className={panels.author}
              data-author={a.author}
              style={{ flexGrow: a.count }}
              title={`@${a.author} · ${formatNumber(a.count)}`}
            >
              <span className={panels.authorBar} data-parity="bar" />
              <span
                className={`${classes.t} ${panels.authorLabel}`}
                data-parity="l"
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <EvHead title="Reviews" right="newest first" />
      <div className={panels.rwHeader} data-parity="Rw Header">
        {HEADS.map(h => (
          <span
            key={h.label}
            className={`${classes.t} ${classes.h} ${h.className}`}
            data-parity="h"
          >
            {h.label}
          </span>
        ))}
      </div>
      {shown.map(row => (
        <ReviewRow key={row.cells[0]} row={row} />
      ))}
      <EvFooter
        count={`Showing ${shown.length} of ${formatNumber(total)}`}
        total={total}
        all={all}
        onToggle={total > FIRST_ROWS ? () => setAll(!all) : undefined}
      />
    </>
  );
}
