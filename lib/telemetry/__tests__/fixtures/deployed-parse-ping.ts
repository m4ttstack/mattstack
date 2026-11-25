/** The relay's own `parsePing` as deployed before pings lost their names: a ping must still pass it. Frozen. */

export interface TelemetryPing {
  installId: string;
  usernames: string[];
  appVersion: string | null;
  rtVersion: string;
  pluginVersion: string | null;
  flavor: 'prod' | 'dev';
  macosVersion: string | null;
  migrationsRecorded: string[];
  migrationsKnown: string[];
  legacyDirs: string[];
  /** `clone` is absent from a Mac older than the field, null when it could not be read or parsed. */
  orgs: { org: string; layout: number | null; clone?: CloneHealth | null }[];
  /** `stale`: the skills that Mac reads as waiting for compile; absent or null as for `clone`. */
  packs: { id: string; version: string | null; stale?: StaleSkill[] | null }[];
  /** Null from a Mac older than the field, or one whose app wrote no status. */
  appUpdate: AppUpdateStatus | null;
}

/** One org clone's health, as `lib/telemetry/clone-health.ts` builds it.
    Paths are org-relative; a pull failure is a kind, never the raw error. */
export interface CloneHealth {
  branch: string | null;
  dataBranch: string | null;
  head: string | null;
  upstream: string | null;
  behind: number | null;
  ahead: number | null;
  lastPullAt: string | null;
  pull: string;
  canPublish: boolean;
  dirtyCount: number;
  dirty: { path: string; status: string }[];
  dirtySince: string | null;
  conflicted: boolean;
  layoutHold: boolean;
}

export interface StaleSkill {
  skill: string;
  causes: string[];
}

export interface AppUpdateStatus {
  lastCheckAt: string | null;
  offeredVersion: string | null;
  heldVersion: string | null;
  hold: string | null;
}

const MAX_ENTRIES = 256;
const MAX_STRING = 128;
/** A deep pack path runs past MAX_STRING; one long path must not drop the ping. */
const MAX_PATH = 512;
const MAX_DIRTY = 40;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_STRING;
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);

function strings(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_ENTRIES) return null;
  return v.every(isStr) ? (v as string[]) : null;
}

function entries<T>(v: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > MAX_ENTRIES) return null;
  const out: T[] = [];
  for (const item of v) {
    const parsed = read(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/** Absent reads as null, so a Mac older than the field still records. */
function appUpdate(v: unknown): AppUpdateStatus | null | undefined {
  if (v === undefined || v === null) return null;
  if (!isRecord(v)) return undefined;
  const { lastCheckAt, offeredVersion, heldVersion, hold } = v;
  if (
    !isStrOrNull(lastCheckAt) ||
    !isStrOrNull(offeredVersion) ||
    !isStrOrNull(heldVersion) ||
    !isStrOrNull(hold)
  ) {
    return undefined;
  }
  return { lastCheckAt, offeredVersion, heldVersion, hold };
}

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isCountOrNull = (v: unknown): v is number | null =>
  v === null || isCount(v);

/** Absent stays absent (an older Mac); anything malformed reads as null. */
function cloneOf(v: unknown): CloneHealth | null | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) return null;
  const strs = [
    'branch',
    'dataBranch',
    'head',
    'upstream',
    'lastPullAt',
    'dirtySince',
  ] as const;
  if (!strs.every(k => isStrOrNull(v[k]))) return null;
  if (!isStr(v.pull) || !isCountOrNull(v.behind) || !isCountOrNull(v.ahead))
    return null;
  if (!isCount(v.dirtyCount)) return null;
  if (
    typeof v.canPublish !== 'boolean' ||
    typeof v.conflicted !== 'boolean' ||
    typeof v.layoutHold !== 'boolean'
  )
    return null;
  if (!Array.isArray(v.dirty) || v.dirty.length > MAX_DIRTY) return null;
  const dirty: CloneHealth['dirty'] = [];
  for (const d of v.dirty) {
    if (
      !isRecord(d) ||
      typeof d.path !== 'string' ||
      d.path.length > MAX_PATH ||
      !isStr(d.status)
    )
      return null;
    dirty.push({ path: d.path, status: d.status });
  }
  return {
    branch: v.branch as string | null,
    dataBranch: v.dataBranch as string | null,
    head: v.head as string | null,
    upstream: v.upstream as string | null,
    behind: v.behind,
    ahead: v.ahead,
    lastPullAt: v.lastPullAt as string | null,
    pull: v.pull,
    canPublish: v.canPublish,
    dirtyCount: v.dirtyCount,
    dirty,
    dirtySince: v.dirtySince as string | null,
    conflicted: v.conflicted,
    layoutHold: v.layoutHold,
  };
}

function staleOf(v: unknown): StaleSkill[] | null | undefined {
  if (v === undefined) return undefined;
  return entries(v, item => {
    if (!isRecord(item) || !isStr(item.skill)) return null;
    const causes = strings(item.causes);
    return causes ? { skill: item.skill, causes } : null;
  });
}

/** The relay's only gate on an unauthenticated body: a fresh object with the
    spec's fields and nothing else, or null. No coercion. */
export function parsePing(raw: unknown): TelemetryPing | null {
  if (!isRecord(raw)) return null;
  const { installId, rtVersion, flavor } = raw;
  if (!isStr(installId) || installId === '' || !isStr(rtVersion)) return null;
  if (flavor !== 'prod' && flavor !== 'dev') return null;
  if (
    !isStrOrNull(raw.appVersion) ||
    !isStrOrNull(raw.pluginVersion) ||
    !isStrOrNull(raw.macosVersion)
  ) {
    return null;
  }
  const usernames = strings(raw.usernames);
  const migrationsRecorded = strings(raw.migrationsRecorded);
  const migrationsKnown = strings(raw.migrationsKnown);
  const legacyDirs = strings(raw.legacyDirs);
  const orgs = entries(raw.orgs, item => {
    if (!isRecord(item) || !isStr(item.org)) return null;
    const { layout } = item;
    if (layout !== null && typeof layout !== 'number') return null;
    const clone = cloneOf(item.clone);
    return clone === undefined
      ? { org: item.org, layout }
      : { org: item.org, layout, clone };
  });
  const packs = entries(raw.packs, item => {
    if (!isRecord(item) || !isStr(item.id) || !isStrOrNull(item.version)) {
      return null;
    }
    const stale = staleOf(item.stale);
    return stale === undefined
      ? { id: item.id, version: item.version }
      : { id: item.id, version: item.version, stale };
  });
  const update = appUpdate(raw.appUpdate);
  if (
    !usernames ||
    !migrationsRecorded ||
    !migrationsKnown ||
    !legacyDirs ||
    !orgs ||
    !packs ||
    update === undefined
  ) {
    return null;
  }
  return {
    installId,
    usernames,
    appVersion: raw.appVersion,
    rtVersion,
    pluginVersion: raw.pluginVersion,
    flavor,
    macosVersion: raw.macosVersion,
    migrationsRecorded,
    migrationsKnown,
    legacyDirs,
    orgs,
    packs,
    appUpdate: update,
  };
}

