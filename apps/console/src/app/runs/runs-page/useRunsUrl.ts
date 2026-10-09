import { useCallback, useMemo } from 'react';
import { useSearch } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { parseDayKey } from '../derive/day';
import type { RunsFilter } from '../derive/lanes';

export type RunsViewName = 'lanes' | 'timeline';

export interface RunsUrl {
  filter: RunsFilter;
  /** A serialized repo identity, or null for every repo. */
  repo: string | null;
  view: RunsViewName;
  /** The timeline's day as `YYYY-MM-DD`; null is today. */
  day: string | null;
}

const FILTERS: readonly RunsFilter[] = ['all', 'live', 'waiting', 'done'];

/** Unknown values read as the defaults, so a stale link opens the Lanes view
    over every run. */
export function parseRunsUrl(search: string): RunsUrl {
  const params = new URLSearchParams(search);
  const filter = params.get('filter');
  return {
    filter: FILTERS.find(f => f === filter) ?? 'all',
    repo: params.get('repo') || null,
    view: params.get('view') === 'timeline' ? 'timeline' : 'lanes',
    day: parseDayKey(params.get('day')),
  };
}

/** The defaults stay out of the query, so the plain page is `/`. Keys this
    page does not own are kept. */
export function formatRunsUrl(search: string, next: RunsUrl): string {
  const params = new URLSearchParams(search);
  const set = (key: string, value: string | null) =>
    value ? params.set(key, value) : params.delete(key);
  set('filter', next.filter === 'all' ? null : next.filter);
  set('repo', next.repo);
  set('view', next.view === 'timeline' ? 'timeline' : null);
  set('day', next.day);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useRunsUrl(): [RunsUrl, (patch: Partial<RunsUrl>) => void] {
  // wouter's search is decodeURI'd, which turns a repo's escaped `%2F` into
  // a slash; it only says when to re-read, and the raw query is parsed.
  const search = useSearch();
  const url = useMemo(() => {
    void search;
    return parseRunsUrl(location.search);
  }, [search]);
  const update = useCallback(
    (patch: Partial<RunsUrl>) => {
      const qs = formatRunsUrl(location.search, { ...url, ...patch });
      navigate(`${location.pathname}${qs}`, { replace: true });
    },
    [url]
  );
  return [url, update];
}
