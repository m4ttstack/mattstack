import { useMemo, useState, type ReactNode } from 'react';

import type { EvidenceRow } from '../../../shared/types';
import { Glyph } from '../../ui/Glyph';
import classes from './evidence.module.css';

export const PAGE_ROWS = 9;

/** Rows whose cells contain the query, first page only until the viewer asks for all. */
export function useEvidenceRows(rows: EvidenceRow[], pageSize = PAGE_ROWS) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.cells.some(c => c.toLowerCase().includes(q)));
  }, [rows, query]);
  const shown = all ? filtered : filtered.slice(0, pageSize);
  return { query, setQuery, all, setAll, filtered, shown };
}

export function EvidenceBar({
  title = 'Evidence',
  placeholder,
  query,
  onQuery,
}: {
  title?: string;
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
}) {
  return (
    <div className={classes.bar} data-parity="Evidence Bar">
      <span
        className={`${classes.t} ${classes.barTitle}`}
        data-parity="Ev Title"
      >
        {title}
      </span>
      <label className={classes.filter} data-parity="Ev Filter">
        <Glyph
          name="search"
          size={13}
          color="var(--tk-text-3)"
          parity="Search"
        />
        <span className={classes.filterField}>
          <span
            className={`${classes.t} ${classes.ph} ${query ? classes.phHidden : ''}`}
            data-parity={query ? undefined : 'Ph'}
            aria-hidden
          >
            {placeholder}
          </span>
          <input
            className={classes.filterInput}
            type="text"
            aria-label={placeholder}
            value={query}
            onChange={e => onQuery(e.currentTarget.value)}
          />
        </span>
      </label>
    </div>
  );
}

export function EvidenceFooter({
  shown,
  total,
  all,
  onToggle,
}: {
  shown: number;
  total: number;
  all: boolean;
  onToggle: () => void;
}) {
  const more = all || shown < total;
  return (
    <div className={classes.footer} data-parity="Ev Footer">
      <span className={`${classes.t} ${classes.count}`} data-parity="Count">
        {`Showing ${shown} of ${total}`}
      </span>
      {more && (
        <button type="button" className={classes.showAll} onClick={onToggle}>
          <span
            className={`${classes.t} ${classes.showAllLabel}`}
            data-parity="sa"
          >
            {all ? 'Show fewer' : `Show all ${total}`}
          </span>
          <Glyph
            name={all ? 'chevronUp' : 'chevronDown'}
            size={13}
            color="var(--tk-text-accent)"
            parity={all ? 'up' : 'down'}
          />
        </button>
      )}
    </div>
  );
}

export function HeaderRow({ children }: { children: ReactNode }) {
  return (
    <div className={classes.header} data-parity="Ev Header" role="row">
      {children}
    </div>
  );
}

export function EmptyEvidence({
  message = 'Nothing in this window',
}: {
  message?: string;
}) {
  return <p className={classes.empty}>{message}</p>;
}
