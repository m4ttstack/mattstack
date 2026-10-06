import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useSettingsScope,
  type EffectiveWire,
  type ExplainRowWire,
  type SettingDefWire,
} from '@mattstack/settings-kit/react';

const BASE = '/api/settings';
// Matches no registered key: that scope instance exists only to lend
// settings-kit's move, which is not exported on its own.
const MOVE_ONLY_PREFIX = 'console.move-only.';

export interface Unregistered {
  key: string;
  scope: string;
  file: string;
}

export interface RepoOption {
  identity: string;
  label: string;
}

type Write = Promise<string | null>;

export interface ConsoleStore {
  defs: SettingDefWire[];
  unregistered: Unregistered[];
  team: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  set: (key: string, scope: string, value: unknown, repo?: string) => Write;
  unset: (key: string, scope: string, repo?: string) => Write;
  move: (key: string, from: string, to: string) => Write;
  prune: (
    key: string,
    scope: string,
    storeName: string,
    repo?: string
  ) => Write;
}

export interface KeyExplain {
  def: SettingDefWire | null;
  rows: ExplainRowWire[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** The repo picked on /settings, or null for all repos. */
export const SettingsRepoContext = createContext<string | null>(null);

export function useSettingsRepo(): string | null {
  return useContext(SettingsRepoContext);
}

/** The machine's one team, as the defs response names it, or null. */
/** Every def the page has loaded, so a form field can show what an empty
    value inherits from another setting. */
export const SettingsDefsContext = createContext<SettingDefWire[]>([]);

/** The display value of a setting path (`board.slack.channel`: the longest
    loaded key it starts with, then the leaf under it), or undefined when
    nothing is set there. */
export function useInheritedValue(
  path: string | undefined
): string | undefined {
  const defs = useContext(SettingsDefsContext);
  if (!path) return undefined;
  const def = defs
    .filter(d => path === d.key || path.startsWith(`${d.key}.`))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (!def) return undefined;
  const rest = path.slice(def.key.length + 1);
  let v: unknown = def.effective.value;
  for (const part of rest ? rest.split('.') : []) {
    v =
      typeof v === 'object' && v !== null && !Array.isArray(v)
        ? (v as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof v === 'string') return v === '' ? undefined : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

export const SettingsTeamContext = createContext<string | null>(null);

export function useSettingsTeam(): string | null {
  return useContext(SettingsTeamContext);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as
    (T & { error?: string }) | null;
  if (!res.ok)
    throw new Error(body?.error ?? `settings request failed: ${res.status}`);
  if (body === null) throw new Error('settings response was not JSON');
  return body;
}

/** The wire types every def as carrying a description, but a def that
    omits one must read as empty rather than crash every string op on it. */
function withDescription(def: SettingDefWire): SettingDefWire {
  return typeof def.description === 'string'
    ? def
    : { ...def, description: '' };
}

function query(params: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** `repo` as a write body's optional field: an object with `repo` when
    given, else no key at all, so an omitted repo never reaches the wire. */
function withRepo(repo?: string): { repo: string } | Record<string, never> {
  return repo ? { repo } : {};
}

const STILL_LOADING =
  'settings are still loading for the picked repo; try again once the list appears';

/** Every registered def under `prefix`, resolved for `repo` when one is
    picked. A write patches its def at once and then re-reads the list
    without raising `loading`, since it can change the def's issues and the
    repos that set it. */
export function useConsoleSettings(
  repo: string | null,
  prefix = ''
): ConsoleStore {
  const [defs, setDefs] = useState<SettingDefWire[]>([]);
  const [unregistered, setUnregistered] = useState<Unregistered[]>([]);
  const [team, setTeam] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const quiet = useRef(false);
  // The repo the defs on screen were read for. A repo switch keeps the old
  // list on screen while the new one loads, and a write from it would land
  // in the newly picked repo, so every write waits until the two agree.
  const loadedFor = useRef<string | null | undefined>(undefined);
  const kit = useSettingsScope(MOVE_ONLY_PREFIX);

  useEffect(() => {
    let alive = true;
    if (!quiet.current) setLoading(true);
    quiet.current = false;
    getJson<{
      defs: SettingDefWire[];
      unregistered?: Unregistered[];
      team?: string | null;
    }>(`${BASE}/defs${query({ prefix, repo })}`)
      .then(body => {
        if (!alive) return;
        setDefs(body.defs.map(withDescription));
        loadedFor.current = repo;
        setUnregistered(body.unregistered ?? []);
        setTeam(typeof body.team === 'string' ? body.team : null);
        setError(null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [prefix, repo, generation]);

  const refresh = useCallback(() => setGeneration(g => g + 1), []);
  const reread = useCallback(() => {
    quiet.current = true;
    setGeneration(g => g + 1);
  }, []);

  const post = useCallback(
    async (
      path: 'set' | 'unset' | 'prune',
      key: string,
      body: Record<string, unknown>
    ): Write => {
      if (loadedFor.current !== repo) return STILL_LOADING;
      try {
        const res = await fetch(`${BASE}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, ...body }),
        });
        const out = (await res.json().catch(() => null)) as {
          effective?: EffectiveWire;
          error?: string;
        } | null;
        if (!res.ok || !out?.effective)
          return out?.error ?? `${path} failed: ${res.status}`;
        const effective = out.effective;
        const bodyRepo = typeof body.repo === 'string' ? body.repo : null;
        setDefs(prev =>
          prev.map(d => {
            if (d.key !== key) return d;
            // A repo-scoped def's `effective` is resolved for the repo the
            // write body carried; patching it here when that repo differs
            // from this hook's own picked repo would show a repo-specific
            // value where the hook reads another repo (or all of them).
            // The reread that follows re-resolves it for the right repo.
            if (d.repoScoped && bodyRepo !== repo) return d;
            return { ...d, effective };
          })
        );
        reread();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [reread, repo]
  );

  const set = useCallback(
    (key: string, scope: string, value: unknown, r?: string) =>
      post('set', key, { scope, value, ...withRepo(r) }),
    [post]
  );
  const unset = useCallback(
    (key: string, scope: string, r?: string) =>
      post('unset', key, { scope, ...withRepo(r) }),
    [post]
  );
  const prune = useCallback(
    (key: string, scope: string, storeName: string, r?: string) =>
      post('prune', key, { scope, storeName, force: true, ...withRepo(r) }),
    [post]
  );
  const { move: kitMove } = kit;
  const move = useCallback(
    async (key: string, from: string, to: string) => {
      if (loadedFor.current !== repo) return STILL_LOADING;
      const err = await kitMove(key, from, to);
      reread();
      return err;
    },
    [kitMove, reread, repo]
  );

  return useMemo(
    () => ({
      defs,
      unregistered,
      team,
      loading,
      error,
      refresh,
      set,
      unset,
      move,
      prune,
    }),
    [defs, unregistered, team, loading, error, refresh, set, unset, move, prune]
  );
}

interface ExplainBody {
  def: SettingDefWire;
  rows: ExplainRowWire[];
}

const explainId = (key: string, repo: string | null) => `${key}\n${repo ?? ''}`;
// The last answer per key and repo. A panel seeded from it draws at its
// final height on its first frame, so its open animates once instead of
// growing to a placeholder and then jumping to the real rows.
const explainCache = new Map<string, ExplainBody>();
const explainInFlight = new Map<string, Promise<void>>();
// Only the newest read per key may fill the cache: a slow read-ahead that
// lands after a panel's fresh read would otherwise seed the next open with
// the older rows.
const explainLatest = new Map<string, number>();
let explainRequests = 0;

function readExplain(key: string, repo: string | null): Promise<ExplainBody> {
  const id = explainId(key, repo);
  const request = ++explainRequests;
  explainLatest.set(id, request);
  return getJson<ExplainBody>(
    `${BASE}/explain/${encodeURIComponent(key)}${query({ repo })}`
  ).then(body => {
    if (explainLatest.get(id) === request) explainCache.set(id, body);
    return body;
  });
}

function warm(key: string, repo: string | null): Promise<void> {
  const id = explainId(key, repo);
  if (explainCache.has(id)) return Promise.resolve();
  const pending =
    explainInFlight.get(id) ??
    readExplain(key, repo)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => explainInFlight.delete(id));
  explainInFlight.set(id, pending);
  return pending;
}

/** Reads ahead what a row's panel reads when it opens: the key's layers for
    the picked repo, or, with none picked, each repo section's too. */
export function prefetchKeyExplain(
  def: Pick<SettingDefWire, 'key' | 'repos'>,
  repo: string | null
): Promise<void> {
  const sections = repo === null ? (def.repos ?? []) : [];
  return Promise.all([
    warm(def.key, repo),
    ...sections.map(r => warm(def.key, r.identity)),
  ]).then(() => undefined);
}

export function resetExplainCache() {
  explainCache.clear();
  explainInFlight.clear();
  explainLatest.clear();
}

/** One key's layer stack, with the picked repo's rungs when one is given.
    A new `revision` re-reads it, for writes made outside the caller. Rows
    read earlier show at once, but `loading` holds until this read lands,
    since a write must not be built from rows that may be stale. */
export function useKeyExplain(
  key: string,
  repo: string | null,
  revision = 0
): KeyExplain {
  const [seed] = useState(() => explainCache.get(explainId(key, repo)));
  const [def, setDef] = useState<SettingDefWire | null>(seed?.def ?? null);
  const [rows, setRows] = useState<ExplainRowWire[]>(seed?.rows ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    readExplain(key, repo)
      .then(body => {
        if (!alive) return;
        setDef(body.def);
        setRows(body.rows);
        setError(null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, repo, generation, revision]);

  const refresh = useCallback(() => setGeneration(g => g + 1), []);
  return useMemo(
    () => ({ def, rows, loading, error, refresh }),
    [def, rows, loading, error, refresh]
  );
}

export function useRepos(): { repos: RepoOption[]; error: string | null } {
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getJson<{ repos?: RepoOption[] }>(`${BASE}/repos`)
      .then(body => alive && setRepos(body.repos ?? []))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);
  return { repos, error };
}
