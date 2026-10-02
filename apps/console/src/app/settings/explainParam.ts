import { useSearchParams } from 'wouter';

import type { PanelTab } from './KeyPanel';

const PARAM = 'explain';
const TAB = 'tab';
const FIX = 'fix';

export interface OpenRow {
  key: string;
  tab: PanelTab;
  fix: string | null;
}

/** The one open settings row, kept in `?explain=` (with `?tab=value` and
    `?fix=<layer>` when they apply) so a reload or a shared link reopens it.
    Every write replaces the history entry: opening a row is not a page. */
export function useOpenRow() {
  const [params, setParams] = useSearchParams();
  const key = params.get(PARAM);
  const open: OpenRow | null = key
    ? {
        key,
        tab: params.get(TAB) === 'value' ? 'value' : 'where',
        fix: params.get(FIX),
      }
    : null;
  const set = (next: OpenRow | null, opts: { repo?: string } = {}) =>
    setParams(
      prev => {
        const p = new URLSearchParams(prev);
        p.delete(TAB);
        p.delete(FIX);
        if (next) {
          p.set(PARAM, next.key);
          if (next.tab === 'value') p.set(TAB, 'value');
          if (next.fix) p.set(FIX, next.fix);
        } else p.delete(PARAM);
        if (opts.repo) p.set('repo', opts.repo);
        return p;
      },
      { replace: true }
    );
  return { open, set };
}

export function explainHref(key: string): string {
  return `/settings?${PARAM}=${encodeURIComponent(key)}`;
}
