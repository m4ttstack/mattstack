import { useCallback } from 'react';
import { useLocation, useSearch } from 'wouter';

export const INPUTS_PARAM = 'inputs';
export const DOC_PARAM = 'doc';

/** `search` edited by `edit`, as a `?query` (or '' when empty), with a flag
    such as `?inputs` kept bare rather than written `inputs=`. */
export function withParams(
  search: string,
  edit: (params: URLSearchParams) => void
): string {
  const params = new URLSearchParams(search);
  edit(params);
  const qs = params.toString().replace(/=(?=&|$)/g, '');
  return qs ? `?${qs}` : '';
}

/** Which run drawer is open. A stage doc wins over the inputs drawer, so
    only one is ever open; `?inputs` stays beside `?doc` as the way back. */
export function drawersOf(search: string): {
  inputs: boolean;
  doc: string | null;
} {
  const params = new URLSearchParams(search);
  const doc = params.get(DOC_PARAM) || null;
  return { inputs: params.has(INPUTS_PARAM) && doc === null, doc };
}

/** Rewrites the query string in place: opening a drawer is not a page. */
export function useDrawerParams() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const write = useCallback(
    (edit: (params: URLSearchParams) => void) =>
      navigate(`${location}${withParams(search, edit)}`, { replace: true }),
    [search, location, navigate]
  );
  return { ...drawersOf(search), write };
}
