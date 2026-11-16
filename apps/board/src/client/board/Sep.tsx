import { Fragment, type ReactNode } from 'react';

/** A drawn dot between two fragments. The space inside keeps a word break
    for copy and screen readers; CSS zeroes its width. */
export function Sep() {
  return <span className="tui-sep"> </span>;
}

/** Fragments with a drawn dot between each pair; empty ones are dropped so
    no dot is left at either end. */
export function withSeps(parts: readonly ReactNode[]): ReactNode[] {
  return parts
    .filter(p => p !== null && p !== undefined && p !== false && p !== '')
    .map((p, i) => (
      <Fragment key={i}>
        {i > 0 && <Sep />}
        {p}
      </Fragment>
    ));
}
