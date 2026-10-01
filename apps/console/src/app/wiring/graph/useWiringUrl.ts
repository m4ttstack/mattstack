import { useCallback, useMemo } from 'react';
import { useSearch } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

export type DrawerTab = 'text' | 'used-by' | 'history';
export type WiringTab = 'graph' | 'surface' | 'health';
export type WiringView = 'template' | 'rendered';

export type WiringUrl = {
  tab: WiringTab;
  pack: string | null;
  focus: string | null;
  select: string | null;
  drawerTab: DrawerTab;
  view: WiringView | null;
  rebind: boolean;
  attention: boolean;
};

const TABS: readonly WiringTab[] = ['graph', 'surface', 'health'];
const DRAWER_TABS: readonly DrawerTab[] = ['text', 'used-by', 'history'];
const VIEWS: readonly WiringView[] = ['template', 'rendered'];

const DEFAULT_TAB: WiringTab = 'graph';
const DEFAULT_DRAWER_TAB: DrawerTab = 'text';

/** Every key this module reads and writes, in the order `formatWiringUrl`
    emits them. */
const KEYS = [
  'tab',
  'pack',
  'focus',
  'select',
  'drawerTab',
  'view',
  'rebind',
  'attention',
] as const;

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | null,
  fallback: T
): T;
function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | null,
  fallback: null
): T | null;
function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | null,
  fallback: T | null
): T | null {
  return allowed.find(candidate => candidate === value) ?? fallback;
}

/**
 * Unknown or malformed values read as the default, so a stale or hand-edited
 * link opens the Graph tab rather than a blank page.
 */
export function parseWiringUrl(search: string): WiringUrl {
  const params = new URLSearchParams(search);
  const text = (key: string) => params.get(key) || null;
  return {
    tab: oneOf(TABS, params.get('tab'), DEFAULT_TAB),
    pack: text('pack'),
    focus: text('focus'),
    select: text('select'),
    drawerTab: oneOf(DRAWER_TABS, params.get('drawerTab'), DEFAULT_DRAWER_TAB),
    view: oneOf(VIEWS, params.get('view'), null),
    rebind: params.get('rebind') === '1',
    attention: params.get('attention') === '1',
  };
}

/** `:` stays literal: refs read as `pipeline:feature` in a shared link, and a
    colon is legal in a query string. */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%3A/g, ':');
}

/**
 * The query string (no leading `?`) for a state, defaults omitted:
 * `parseWiringUrl(formatWiringUrl(x))` equals `x`.
 */
export function formatWiringUrl(state: WiringUrl): string {
  const pairs: Array<[string, string | null]> = [
    ['tab', state.tab === DEFAULT_TAB ? null : state.tab],
    ['pack', state.pack],
    ['focus', state.focus],
    ['select', state.select],
    [
      'drawerTab',
      state.drawerTab === DEFAULT_DRAWER_TAB ? null : state.drawerTab,
    ],
    ['view', state.view],
    ['rebind', state.rebind ? '1' : null],
    ['attention', state.attention ? '1' : null],
  ];
  return pairs
    .flatMap(([key, value]) => (value ? [`${key}=${encodeValue(value)}`] : []))
    .join('&');
}

const TEXT_KEYS = ['pack', 'focus', 'select'] as const;

/** An omitted key keeps its value; an empty string is no value, the same as
    `null`, so `focus: ''` is neither written to the URL nor a refocus. */
function normalise(change: Partial<WiringUrl>): Partial<WiringUrl> {
  const defined = Object.fromEntries(
    Object.entries(change).filter(([, value]) => value !== undefined)
  ) as Partial<WiringUrl>;
  for (const key of TEXT_KEYS) if (defined[key] === '') defined[key] = null;
  return defined;
}

function otherParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of KEYS) params.delete(key);
  return params.toString();
}

/**
 * Where-you-are keys push so Back retraces them; in-place view state replaces
 * so Back does not step through every row click.
 */
function pushes(current: WiringUrl, next: WiringUrl): boolean {
  return (
    current.tab !== next.tab ||
    current.pack !== next.pack ||
    current.focus !== next.focus
  );
}

/**
 * The Graph tab's state, read from and written to the query string.
 *
 * Changes cascade down one chain: a new `pack` drops `focus`, a new `focus`
 * drops `select`, a new `select` drops `rebind` and `view`. A value set in
 * the same patch always wins over the drop, so a deep link patches the whole
 * chain in one call. Query keys this hook does not own are kept.
 */
export function useWiringUrl(): [
  WiringUrl,
  (patch: Partial<WiringUrl>) => void,
] {
  const search = useSearch();
  const state = useMemo(() => parseWiringUrl(search), [search]);

  // Reads the live location, not the last render's state, so two patches in
  // one tick compose instead of the second overwriting the first.
  const patch = useCallback((requested: Partial<WiringUrl>) => {
    const change = normalise(requested);
    const liveSearch = window.location.search;
    const current = parseWiringUrl(liveSearch);
    const next: WiringUrl = { ...current, ...change };

    const packChanged = next.pack !== current.pack;
    if (packChanged && change.focus === undefined) next.focus = null;
    const focusChanged = packChanged || next.focus !== current.focus;
    if (focusChanged && change.select === undefined) next.select = null;
    if (focusChanged || next.select !== current.select) {
      if (change.rebind === undefined) next.rebind = false;
      if (change.view === undefined) next.view = null;
    }

    const query = formatWiringUrl(next);
    if (query === formatWiringUrl(current)) return;

    const rest = otherParams(liveSearch);
    const joined = [query, rest].filter(Boolean).join('&');
    navigate(`${window.location.pathname}${joined ? `?${joined}` : ''}`, {
      replace: !pushes(current, next),
    });
  }, []);

  return [state, patch];
}
