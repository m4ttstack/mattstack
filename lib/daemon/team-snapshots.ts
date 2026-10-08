/**
 * One snapshot engine per team clone under ~/.mattstack/orgs. Clones
 * appear (team.join, team.create) and disappear while the daemon runs, so
 * the set is rescanned on an orgs/ watch event, never fixed at boot.
 */

import { existsSync, readdirSync, readFileSync, watch as fsWatch } from "fs";
import { join } from "path";
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";

import { getSetting } from "../settings/resolve.ts";
import type { Value } from "../settings/registry-schemas.ts";
import { orgsDir } from "../rt-paths.ts";
import { createRealProbes, type Probes } from "../setup/probes.ts";
import { convergePackCache } from "../setup/pack-cache.ts";
import { parseOriginUrl } from "../setup/team-settings.ts";
import { UserActionableError } from "../errors.ts";
import { ownedRoots } from "../../packages/rt-client/src/settings/org-roles.ts";
import { roleFor } from "../team/roles.ts";
import {
  startSnapshot,
  teamSnapshotSpec,
  type HomeSnapshotSettings,
  type PullResult,
  type SnapshotHandle,
  type SnapshotStatus,
} from "./home-snapshot.ts";
import { clampPullIntervalSec, PULL_INTERVAL_FALLBACK_SEC } from "./snapshot-interval.ts";

export type TeamSnapshotSettings = Value<"rt.teamSnapshot">;

export interface TeamSnapshotEntry extends SnapshotStatus {
  slug: string;
}

export interface TeamSnapshotsDeps {
  log: Logger;
  broadcast: (type: string, data: unknown) => void;
  orgsDir?: string;
  probes?: Probes;
  readSettings?: () => TeamSnapshotSettings;
  start?: typeof startSnapshot;
  watch?: (path: string, options: { recursive: boolean }, listener: (eventType: string, filename: string | null) => void) => { close(): void };
  setTimeout?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (h: ReturnType<typeof setTimeout>) => void;
  exec?: Parameters<typeof startSnapshot>[1]["exec"];
  db?: Database;
  /** Injectable so tests never shell out to a real claude. */
  converge?: typeof convergePackCache;
  /** Runs after every pull that moved a clone, even when the converge threw. */
  afterPull?: (slug: string) => Promise<void>;
}

export interface TeamSnapshotsHandle {
  stop(): void;
  rescan(): Promise<void>;
  status(): TeamSnapshotEntry[];
  pullNow(slug: string): Promise<PullResult>;
  ready: Promise<void>;
  /** Stops these clones' engines, waits (up to `PAUSE_SETTLE_MS` each) for git work they already started, and keeps `rescan` from starting them until `resume`: `org:move` renames a clone's folder and must not race a pull into it. */
  pause(slugs: string[]): Promise<void>;
  /** Lifts `pause`, arms the orgs/ watch when boot could not, then rescans. */
  resume(slugs: string[]): Promise<void>;
}

const RESCAN_DEBOUNCE_MS = 2000;
export const PAUSE_SETTLE_MS = 30_000;


function originOf(dir: string): string | null {
  try {
    return parseOriginUrl(readFileSync(join(dir, ".git", "config"), "utf8"));
  } catch {
    return null;
  }
}

export function startTeamSnapshots(rawDeps: TeamSnapshotsDeps): TeamSnapshotsHandle {
  const orgsRoot = rawDeps.orgsDir ?? orgsDir();
  const probes = rawDeps.probes ?? createRealProbes();
  const start = rawDeps.start ?? startSnapshot;
  const watch = rawDeps.watch ?? (fsWatch as unknown as NonNullable<TeamSnapshotsDeps["watch"]>);
  const setTimer = rawDeps.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimer = rawDeps.clearTimeout ?? ((h: ReturnType<typeof setTimeout>) => clearTimeout(h));
  const readSettings = rawDeps.readSettings ?? (() => getSetting<TeamSnapshotSettings>("rt.teamSnapshot").value);
  const converge = rawDeps.converge ?? convergePackCache;
  const instances = new Map<string, { handle: SnapshotHandle; dir: string; owned: string }>();
  const held = new Set<string>();
  const skippedNoRemote = new Set<string>();
  let watcher: { close(): void } | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** Dedup key for safeRescan's warn: an `orgs/` that stays unreadable must warn once, not on every interval tick for the life of the daemon. */
  let lastLoggedScanError: string | null = null;

  /** A clone that gains its origin after boot (`rt team publish --remote`) edits .git/config, which the non-recursive orgs/ watch never sees; this interval rescan, on the pull interval, is what picks it up. */
  function scheduleRescan(): void {
    if (stopped) return;
    interval = setTimer(() => { interval = null; void safeRescan().finally(scheduleRescan); }, clampPullIntervalSec(settings().pullIntervalSec) * 1000);
  }

  /**
   * Every internal rescan goes through here, never `rescan()` raw. A throw out
   * of the scan (`orgs/` replaced by a regular file, EACCES, EMFILE) would
   * otherwise reject a `void`-ed promise, and an unhandled rejection during the
   * daemon's boot window is a fatal + `process.exit(1)` in
   * `installCrashHandlers`. The supervisor degrades instead: warn, discover
   * nothing this pass, and let the next tick try again.
   */
  async function safeRescan(): Promise<void> {
    try {
      await rescan();
      lastLoggedScanError = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastLoggedScanError) {
        rawDeps.log.warn({ err, orgsRoot }, "team-snapshots: could not scan orgs/; no clones are being snapshotted until it is readable");
        lastLoggedScanError = message;
      }
    }
  }

  function settings(): TeamSnapshotSettings {
    try {
      return readSettings();
    } catch (err) {
      rawDeps.log.warn({ err }, "team-snapshots: failed to read rt.teamSnapshot; treating as enabled with defaults");
      return { enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30, pullIntervalSec: PULL_INTERVAL_FALLBACK_SEC };
    }
  }

  /** The engine reads home-shaped settings and clamps them itself; `pullIntervalSec` is the supervisor's alone and rides on the spec instead. */
  function snapshotSettings(s: TeamSnapshotSettings): HomeSnapshotSettings {
    const { pullIntervalSec: _pullIntervalSec, ...rest } = s;
    return rest;
  }

  function ownedFor(slug: string): string[] {
    return ownedRoots(roleFor(probes, slug));
  }

  async function rescan(): Promise<void> {
    if (stopped) return;
    const s = settings();
    if (s.enabled === false) {
      for (const [slug, inst] of instances) { inst.handle.stop(); instances.delete(slug); }
      return;
    }
    const present = new Set<string>();
    // A missing orgs/ dir is the team-of-none case, not an error.
    if (existsSync(orgsRoot)) {
      for (const slug of readdirSync(orgsRoot).sort()) {
        const dir = join(orgsRoot, slug);
        if (!existsSync(join(dir, ".git"))) continue;
        if (held.has(slug)) continue;
        present.add(slug);
        const roots = ownedFor(slug);
        const owned = roots.join("\n");
        const running = instances.get(slug);
        if (running) {
          if (running.owned === owned) continue;
          running.handle.stop();
          instances.delete(slug);
          rawDeps.log.info({ slug, ownedRoots: roots }, "team-snapshots: ownership changed; restarting");
        }
        const originUrl = originOf(dir);
        if (!originUrl) {
          if (!skippedNoRemote.has(slug)) {
            rawDeps.log.warn({ slug, dir }, "team-snapshots: clone has no origin; snapshotted once `rt team publish --remote` gives it one (picked up within the rescan interval)");
            skippedNoRemote.add(slug);
          }
          continue;
        }
        skippedNoRemote.delete(slug);
        const spec = teamSnapshotSpec(slug, dir, {
          pullIntervalSec: clampPullIntervalSec(s.pullIntervalSec),
          originUrl,
          probes,
          ownedRoots: roots,
          log: rawDeps.log.child({ team: slug }),
          onPulled: async () => {
            try {
              await converge(probes, slug, rawDeps.log.child({ team: slug }));
            } finally {
              await rawDeps.afterPull?.(slug);
            }
          },
        });
        const handle = start(spec, {
          log: rawDeps.log.child({ team: slug }),
          broadcast: rawDeps.broadcast,
          exec: rawDeps.exec,
          watch: rawDeps.watch,
          setTimeout: rawDeps.setTimeout,
          clearTimeout: rawDeps.clearTimeout,
          db: rawDeps.db,
          readSettings: () => snapshotSettings(settings()),
        });
        instances.set(slug, { handle, dir, owned });
        rawDeps.log.info({ slug }, "team-snapshots: watching");
      }
    }
    for (const [slug, inst] of instances) {
      if (!present.has(slug)) {
        inst.handle.stop();
        instances.delete(slug);
        rawDeps.log.info({ slug }, "team-snapshots: clone removed; stopped");
      }
    }
  }

  /** Arms the non-recursive orgs/ watch once; a boot on a Mac whose orgs/ does not exist yet leaves it unarmed, and `resume` tries again after a move created the root. */
  function armWatch(): void {
    if (watcher || stopped) return;
    try {
      watcher = watch(orgsRoot, { recursive: false }, () => {
        if (debounce) clearTimer(debounce);
        debounce = setTimer(() => { debounce = null; void safeRescan(); }, RESCAN_DEBOUNCE_MS);
      });
    } catch (err) {
      rawDeps.log.warn({ err, orgsRoot }, "team-snapshots: cannot watch orgs/; new clones are picked up on the interval rescan");
    }
  }

  /** A git child that outlives the bound is logged and left: the move then runs beside it, which the move's own clone checks are there to catch. */
  async function settleWithin(slug: string, handle: SnapshotHandle): Promise<void> {
    let expire!: () => void;
    const timedOut = new Promise<"timeout">((resolve) => { expire = () => resolve("timeout"); });
    const timer = setTimer(() => expire(), PAUSE_SETTLE_MS);
    const outcome = await Promise.race([handle.settled().then(() => "settled" as const), timedOut]);
    clearTimer(timer);
    if (outcome === "timeout") rawDeps.log.warn({ slug, waitedMs: PAUSE_SETTLE_MS }, "team-snapshots: git work in the paused clone is still running; continuing");
  }

  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

  void boot();

  /** Mirrors the engine's `init()`: whatever happens, `ready` resolves and nothing rejects out of here, because the daemon `void`s this during boot. */
  async function boot(): Promise<void> {
    try {
      await safeRescan();
      if (stopped) return;
      armWatch();
      // Armed even when the setting is off, unlike the engine's own startup:
      // `rescan` returns early on its own while disabled, so a live flip of
      // `rt.teamSnapshot.enabled` is discovered on the next watch event or
      // interval tick rather than only after a daemon restart.
      scheduleRescan();
    } catch (err) {
      rawDeps.log.warn({ err, orgsRoot }, "team-snapshots: startup arming failed; inert");
    } finally {
      resolveReady();
    }
  }

  return {
    ready,
    rescan,
    stop() {
      stopped = true;
      if (watcher) { try { watcher.close(); } catch { /* already closed */ } watcher = null; }
      if (debounce) clearTimer(debounce);
      if (interval) clearTimer(interval);
      for (const inst of instances.values()) inst.handle.stop();
      instances.clear();
    },
    async pause(slugs) {
      const stopping: { slug: string; handle: SnapshotHandle }[] = [];
      for (const slug of slugs) {
        held.add(slug);
        const inst = instances.get(slug);
        if (!inst) continue;
        inst.handle.stop();
        instances.delete(slug);
        stopping.push({ slug, handle: inst.handle });
        rawDeps.log.info({ slug }, "team-snapshots: paused for a folder move");
      }
      await Promise.all(stopping.map(({ slug, handle }) => settleWithin(slug, handle)));
    },
    async resume(slugs) {
      for (const slug of slugs) held.delete(slug);
      armWatch();
      await safeRescan();
    },
    status: () => [...instances.entries()].map(([slug, inst]) => ({ slug, ...inst.handle.status() })),
    async pullNow(slug) {
      const inst = instances.get(slug);
      if (!inst) throw new UserActionableError("no-team", `team "${slug}" is not cloned locally (or has no origin)`);
      return inst.handle.pullNow();
    },
  };
}
