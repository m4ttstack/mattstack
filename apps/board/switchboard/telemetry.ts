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
  orgs: { org: string; layout: number | null }[];
  packs: { id: string; version: string | null }[];
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

export function macLabel(row: MacRow): string {
  return (
    row.verifiedUsername ||
    (row.usernames.length > 0 ? row.usernames.join(', ') : row.installId)
  );
}

function segments(version: string): number[] {
  return version.split('.').map(part => Number.parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string): number {
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

export class TelemetryStore {
  constructor(private db: Database) {
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
  }

  record(
    ping: TelemetryPing,
    verifiedUsername: string | null,
    now: number
  ): void {
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

  private noteChange(
    installId: string,
    kind: 'app' | 'rt',
    from: string | null,
    to: string | null,
    at: number
  ): void {
    if (to === null || to === from) return;
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
      .map(r => ({
        ...(JSON.parse(r.ping) as TelemetryPing),
        verifiedUsername: r.verified_username,
        lastSeen: r.last_seen,
        running: now - r.last_seen <= RUNNING_WINDOW_MS,
      }));
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
      updates,
    };
  }
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
  return ids.map(id => {
    const notRun: string[] = [];
    const tooOld: string[] = [];
    for (const m of macs) {
      if (!m.migrationsKnown.includes(id)) tooOld.push(macLabel(m));
      else if (!m.migrationsRecorded.includes(id)) notRun.push(macLabel(m));
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
  for (const m of macs) {
    for (const pack of m.packs) addTo(byPack, pack.id, pack.version);
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
      return { id, oldestVersion, macs: versions.length };
    });
}
