/** The version-telemetry store: one row per Mac, keyed by install id, holding
    the latest ping as JSON plus an append-only list of app and rt version
    changes. Pings carry no repos, hostnames, paths or commands; the shape is
    the Mac-side `TelemetryPing` in `lib/telemetry/ping.ts`, redeclared here
    because the relay image copies only `apps/board/switchboard/*.ts`. */
import type { Database } from 'bun:sqlite';

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

/** What the clone timeline records: every org's clone minus its pull time,
    and every pack's stale skills, as one Mac last reported them. */
export interface CloneState {
  clones: Record<string, Omit<CloneHealth, 'lastPullAt'> | null>;
  stale: Record<string, StaleSkill[] | null>;
}

export interface CloneReportMac {
  installId: string;
  label: string;
  lastSeen: number;
  running: boolean;
  appVersion: string | null;
  rtVersion: string;
  pluginVersion: string | null;
  macosVersion: string | null;
  orgs: {
    org: string;
    layout: number | null;
    clone: CloneHealth | null;
    flags: string[];
  }[];
  packs: { id: string; version: string | null; stale: StaleSkill[] | null }[];
}

export interface CloneReport {
  macs: CloneReportMac[];
  events: {
    installId: string;
    label: string;
    at: number;
    state: CloneState;
  }[];
}

export interface AppUpdateStatus {
  lastCheckAt: string | null;
  offeredVersion: string | null;
  heldVersion: string | null;
  hold: string | null;
}

export interface MacRow extends TelemetryPing {
  verifiedUsername: string | null;
  lastSeen: number;
  running: boolean;
}

export interface TelemetrySnapshot {
  macs: MacRow[];
  versions: {
    kind: 'app' | 'rt';
    version: string;
    macs: number;
    lastSeen: number;
  }[];
  migrations: { id: string; notRun: string[]; tooOld: string[] }[];
  legacyDirs: { label: string; dirs: string[] }[];
  orgLayouts: { org: string; layout: number | null; macs: string[] }[];
  clones: {
    label: string;
    org: string;
    flags: string[];
    lastPullAt: string | null;
    stale: number;
  }[];
  packs: { id: string; oldestVersion: string | null; macs: number }[];
  updates: {
    label: string;
    kind: 'app' | 'rt';
    from: string | null;
    to: string;
    at: number;
  }[];
}

const RUNNING_WINDOW_MS = 60 * 60_000;
const RETENTION_MS = 90 * 24 * 60 * 60_000;

type MacDbRow = {
  install_id: string;
  ping: string;
  verified_username: string | null;
  last_seen: number;
};

type UpdateDbRow = {
  install_id: string;
  kind: 'app' | 'rt';
  from_version: string | null;
  to_version: string;
  at: number;
};

const MAX_ENTRIES = 256;
const MAX_STRING = 128;
/** A deep pack path runs past MAX_STRING; one long path must not drop the ping. */
const MAX_PATH = 512;
const MAX_DIRTY = 40;
const STALE_PULL_MS = 6 * 60 * 60_000;

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

/** What is wrong with one clone, in words for the telemetry page; empty when healthy. */
export function cloneFlags(c: CloneHealth, now: number): string[] {
  const flags: string[] = [];
  const pulledAt = c.lastPullAt ? Date.parse(c.lastPullAt) : NaN;
  if (!Number.isFinite(pulledAt) || now - pulledAt > STALE_PULL_MS)
    flags.push('no good pull in 6h+');
  if (c.pull !== 'ok') flags.push(`last pull: ${c.pull}`);
  if ((c.behind ?? 0) > 0) flags.push(`behind origin by ${c.behind}`);
  if (!c.canPublish && c.dirtyCount > 0)
    flags.push(
      `${c.dirtyCount} uncommitted files on a Mac that cannot publish them`
    );
  if (c.conflicted) flags.push('rebase stopped mid-way');
  if (c.layoutHold) flags.push('pull held for a layout this app cannot read');
  return flags;
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

/** The display name every section uses. Self-reported usernames are
    spoofable, so they carry the marker; a verified username and the bare
    install id do not. */
export function macLabel(row: MacRow): string {
  if (row.verifiedUsername) return row.verifiedUsername;
  if (row.usernames.length > 0)
    return `${row.usernames.join(', ')} (unverified)`;
  return row.installId;
}

function segments(version: string): number[] {
  return version
    .replace(/^v/, '')
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Pings are unauthenticated, so the table needs a ceiling no sender can grow. */
export const TELEMETRY_MAX_MACS = 2000;

export class TelemetryStore {
  constructor(
    private db: Database,
    private maxMacs: number = TELEMETRY_MAX_MACS
  ) {
    db.run(`CREATE TABLE IF NOT EXISTS telemetry_macs (
      install_id TEXT PRIMARY KEY,
      ping TEXT NOT NULL,
      verified_username TEXT,
      last_seen INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS telemetry_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      install_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      from_version TEXT,
      to_version TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
    db.run(
      `CREATE INDEX IF NOT EXISTS telemetry_updates_install_id ON telemetry_updates (install_id)`
    );
    db.run(`CREATE TABLE IF NOT EXISTS telemetry_clone_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      install_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      state TEXT NOT NULL
    )`);
    db.run(
      `CREATE INDEX IF NOT EXISTS telemetry_clone_events_install_id ON telemetry_clone_events (install_id)`
    );
  }

  /** False only for an install id the table has not seen while it is full. */
  canRecord(installId: string): boolean {
    const known = this.db
      .query(`SELECT 1 FROM telemetry_macs WHERE install_id = ?`)
      .get(installId);
    if (known) return true;
    const row = this.db
      .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM telemetry_macs`)
      .get();
    return (row?.n ?? 0) < this.maxMacs;
  }

  record(
    input: TelemetryPing,
    verifiedUsername: string | null,
    now: number
  ): void {
    const ping = parsePing(input);
    if (!ping) return;
    this.db.transaction(() => {
      const previous = this.db
        .query<{ ping: string }, [string]>(
          `SELECT ping FROM telemetry_macs WHERE install_id = ?`
        )
        .get(ping.installId);
      if (previous) {
        const before = JSON.parse(previous.ping) as TelemetryPing;
        this.noteChange(
          ping.installId,
          'app',
          before.appVersion,
          ping.appVersion,
          now
        );
        this.noteChange(
          ping.installId,
          'rt',
          before.rtVersion,
          ping.rtVersion,
          now
        );
      }
      this.noteCloneState(ping, now);
      this.db.run(
        `INSERT INTO telemetry_macs (install_id, ping, verified_username, last_seen)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (install_id) DO UPDATE SET
           ping = excluded.ping,
           verified_username = excluded.verified_username,
           last_seen = excluded.last_seen`,
        [ping.installId, JSON.stringify(ping), verifiedUsername, now]
      );
    })();
  }

  /** Appends the Mac's clone state when it differs from the last one kept;
      a pull that only moved the pull time is not a change. */
  private noteCloneState(ping: TelemetryPing, at: number): void {
    const reports =
      ping.orgs.some(o => o.clone !== undefined) ||
      ping.packs.some(p => p.stale !== undefined);
    if (!reports) return;
    const state: CloneState = { clones: {}, stale: {} };
    for (const o of ping.orgs) {
      if (o.clone === undefined) continue;
      if (o.clone === null) {
        state.clones[o.org] = null;
        continue;
      }
      const { lastPullAt: _pulledAt, ...rest } = o.clone;
      state.clones[o.org] = rest;
    }
    for (const p of ping.packs)
      if (p.stale !== undefined) state.stale[p.id] = p.stale;
    const text = JSON.stringify(state);
    const last = this.db
      .query<{ state: string }, [string]>(
        `SELECT state FROM telemetry_clone_events WHERE install_id = ? ORDER BY at DESC, id DESC LIMIT 1`
      )
      .get(ping.installId);
    if (last?.state === text) return;
    this.db.run(
      `INSERT INTO telemetry_clone_events (install_id, at, state) VALUES (?, ?, ?)`,
      [ping.installId, at, text]
    );
  }

  /** Every Mac's clones with what is wrong with them, and their clone
      timeline, for one person (a verified or reported username) or all. */
  cloneReport(now: number, user?: string): CloneReport {
    const macs = this.snapshot(now).macs.filter(
      m =>
        user === undefined ||
        m.verifiedUsername === user ||
        m.usernames.includes(user)
    );
    const labels = new Map(macs.map(m => [m.installId, macLabel(m)]));
    const ids = [...labels.keys()];
    const events =
      ids.length === 0
        ? []
        : this.db
            .query<{ install_id: string; at: number; state: string }, string[]>(
              `SELECT install_id, at, state FROM telemetry_clone_events
               WHERE install_id IN (${ids.map(() => '?').join(',')}) ORDER BY at, id`
            )
            .all(...ids)
            .map(e => ({
              installId: e.install_id,
              label: labels.get(e.install_id) ?? e.install_id,
              at: e.at,
              state: JSON.parse(e.state) as CloneState,
            }));
    return {
      macs: macs.map(m => ({
        installId: m.installId,
        label: macLabel(m),
        lastSeen: m.lastSeen,
        running: m.running,
        appVersion: m.appVersion,
        rtVersion: m.rtVersion,
        pluginVersion: m.pluginVersion,
        macosVersion: m.macosVersion,
        orgs: m.orgs.map(o => ({
          org: o.org,
          layout: o.layout,
          clone: o.clone ?? null,
          flags: o.clone ? cloneFlags(o.clone, now) : [],
        })),
        packs: m.packs.map(p => ({
          id: p.id,
          version: p.version,
          stale: p.stale ?? null,
        })),
      })),
      events,
    };
  }

  private noteChange(
    installId: string,
    kind: 'app' | 'rt',
    from: string | null,
    to: string | null,
    at: number
  ): void {
    if (from === null || to === null || to === from) return;
    this.db.run(
      `INSERT INTO telemetry_updates (install_id, kind, from_version, to_version, at)
       VALUES (?, ?, ?, ?, ?)`,
      [installId, kind, from, to, at]
    );
  }

  prune(now: number): void {
    const cutoff = now - RETENTION_MS;
    this.db.transaction(() => {
      this.db.run(
        `DELETE FROM telemetry_updates WHERE install_id IN
           (SELECT install_id FROM telemetry_macs WHERE last_seen < ?)`,
        [cutoff]
      );
      this.db.run(`DELETE FROM telemetry_clone_events WHERE at < ?`, [cutoff]);
      this.db.run(`DELETE FROM telemetry_macs WHERE last_seen < ?`, [cutoff]);
    })();
  }

  snapshot(now: number): TelemetrySnapshot {
    const macs: MacRow[] = this.db
      .query<MacDbRow, []>(
        `SELECT install_id, ping, verified_username, last_seen
         FROM telemetry_macs ORDER BY last_seen DESC, install_id`
      )
      .all()
      .map(r => {
        const ping = JSON.parse(r.ping) as TelemetryPing;
        return {
          ...ping,
          appUpdate: ping.appUpdate ?? null,
          verifiedUsername: r.verified_username,
          lastSeen: r.last_seen,
          running: now - r.last_seen <= RUNNING_WINDOW_MS,
        };
      });
    const labels = new Map(macs.map(m => [m.installId, macLabel(m)]));

    const updates = this.db
      .query<UpdateDbRow, []>(
        `SELECT install_id, kind, from_version, to_version, at
         FROM telemetry_updates ORDER BY at DESC, id DESC`
      )
      .all()
      .map(u => ({
        label: labels.get(u.install_id) ?? u.install_id,
        kind: u.kind,
        from: u.from_version,
        to: u.to_version,
        at: u.at,
      }));

    return {
      macs,
      versions: versionCounts(macs),
      migrations: migrationStatus(macs),
      legacyDirs: macs
        .filter(m => m.legacyDirs.length > 0)
        .map(m => ({ label: macLabel(m), dirs: m.legacyDirs })),
      orgLayouts: orgLayouts(macs),
      packs: packStatus(macs),
      clones: flaggedClones(macs, now),
      updates,
    };
  }
}

/** Every org clone with something wrong, so the page can lead with it; the
    full detail and its timeline are in `/telemetry/clones.json`. */
function flaggedClones(
  macs: MacRow[],
  now: number
): TelemetrySnapshot['clones'] {
  return macs.flatMap(m => {
    const stale = m.packs.reduce((n, p) => n + (p.stale?.length ?? 0), 0);
    return m.orgs.flatMap(o => {
      const flags = o.clone ? cloneFlags(o.clone, now) : [];
      return flags.length === 0
        ? []
        : [
            {
              label: macLabel(m),
              org: o.org,
              flags,
              lastPullAt: o.clone!.lastPullAt,
              stale,
            },
          ];
    });
  });
}

function versionCounts(macs: MacRow[]): TelemetrySnapshot['versions'] {
  const seen = new Map<
    string,
    { kind: 'app' | 'rt'; version: string; macs: number; lastSeen: number }
  >();
  const add = (
    kind: 'app' | 'rt',
    version: string | null,
    lastSeen: number
  ) => {
    if (version === null) return;
    const key = `${kind}\0${version}`;
    const entry = seen.get(key) ?? { kind, version, macs: 0, lastSeen: 0 };
    entry.macs += 1;
    entry.lastSeen = Math.max(entry.lastSeen, lastSeen);
    seen.set(key, entry);
  };
  for (const m of macs) {
    add('app', m.appVersion, m.lastSeen);
    add('rt', m.rtVersion, m.lastSeen);
  }
  return [...seen.values()].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) || compareVersions(b.version, a.version)
  );
}

function migrationStatus(macs: MacRow[]): TelemetrySnapshot['migrations'] {
  const ids = [...new Set(macs.flatMap(m => m.migrationsKnown))].sort();
  const sets = macs.map(m => ({
    label: macLabel(m),
    known: new Set(m.migrationsKnown),
    recorded: new Set(m.migrationsRecorded),
  }));
  return ids.map(id => {
    const notRun: string[] = [];
    const tooOld: string[] = [];
    for (const { label, known, recorded } of sets) {
      if (!known.has(id)) tooOld.push(label);
      else if (!recorded.has(id)) notRun.push(label);
    }
    return { id, notRun, tooOld };
  });
}

function orgLayouts(macs: MacRow[]): TelemetrySnapshot['orgLayouts'] {
  const groups = new Map<
    string,
    { org: string; layout: number | null; macs: string[] }
  >();
  for (const m of macs) {
    for (const { org, layout } of m.orgs) {
      const key = `${org}\0${layout}`;
      const group = groups.get(key) ?? { org, layout, macs: [] };
      group.macs.push(macLabel(m));
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort(
    (a, b) => a.org.localeCompare(b.org) || (a.layout ?? -1) - (b.layout ?? -1)
  );
}

function packStatus(macs: MacRow[]): TelemetrySnapshot['packs'] {
  const byPack = new Map<string, (string | null)[]>();
  const macCounts = new Map<string, number>();
  for (const m of macs) {
    const ids = new Set<string>();
    for (const pack of m.packs) {
      ids.add(pack.id);
      addTo(byPack, pack.id, pack.version);
    }
    for (const id of ids) macCounts.set(id, (macCounts.get(id) ?? 0) + 1);
  }
  return [...byPack.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, versions]) => {
      const known = versions.filter((v): v is string => v !== null);
      const oldestVersion =
        known.length === 0
          ? null
          : known.reduce((oldest, v) =>
              compareVersions(v, oldest) < 0 ? v : oldest
            );
      return { id, oldestVersion, macs: macCounts.get(id) ?? 0 };
    });
}
