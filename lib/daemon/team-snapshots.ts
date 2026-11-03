/**
 * One snapshot engine per team clone under ~/.mattstack/orgs. Clones
 * appear (team.join, team.create) and disappear while the daemon runs, so
 * the set is rescanned on an orgs/ watch event, never fixed at boot.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, watch as fsWatch } from "fs";
import { join, resolve } from "path";
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";

import { getSetting } from "../settings/resolve.ts";
import type { Value } from "../settings/registry-schemas.ts";
import { orgsDir } from "../rt-paths.ts";
import { createRealProbes, type Probes } from "../setup/probes.ts";
import { claudeMessage, convergePackCache, isAlready, PACK_EXEC_TIMEOUT_MS } from "../setup/pack-cache.ts";
import { generatedMarketplaceRef, writeGeneratedMarketplace } from "../setup/generated-marketplace.ts";
import { parseMarketplaceList } from "../setup/marketplace-list.ts";
import { claudeConfigDirs } from "../setup/tools-install.ts";
import { resolveTool } from "../deps/resolve.ts";
import { cswapConfigDirs } from "../cswap.ts";
import { checkedOutBranch } from "../team/org-branch.ts";
import { pickedCloneReady, pickOrgClone } from "../team/org-layout.ts";
import { markerState } from "../team/org-marker.ts";
import { ORG_STORE_REL } from "../../packages/rt-client/src/settings/paths.ts";
import { warn } from "../ui/warn.ts";
import { hasKvValue, setKvValue } from "../state/kv-blob.ts";
import { parseOriginUrl } from "../setup/team-settings.ts";
import { UserActionableError } from "../errors.ts";
import { ownedRoots } from "../../packages/rt-client/src/settings/org-roles.ts";
import { applyRoleCone } from "../team/org-cone.ts";
import { convergeDataBranch, type ConvergeResult } from "../team/org-data-branch.ts";
import { disableModelInvocationConfigDirs, readDisableModelInvocationChoices, reconcileDisableModelInvocation } from "../skills/disable-model-invocation.ts";
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
  /** Injectable so tests never reach the keychain; the forge token both the engine's git and the data-branch move offer origin. */
  readToken?: (p: Probes, remote: string) => Promise<string | null>;
  moveData?: typeof convergeDataBranch;
}

export interface TeamSnapshotsHandle {
  stop(): void;
  rescan(): Promise<void>;
  status(): TeamSnapshotEntry[];
  pullNow(slug: string): Promise<PullResult>;
  /** The data branch move, under the clone engine's git lock so it never lands beside a commit cycle. */
  moveNow(slug: string): Promise<ConvergeResult | null>;
  ready: Promise<void>;
  /** Stops these clones' engines, waits (up to `PAUSE_SETTLE_MS` each) for git work they already started, and keeps `rescan` from starting them until `resume`: `org:move` renames a clone's folder and must not race a pull into it. */
  pause(slugs: string[]): Promise<void>;
  /** Lifts `pause`, arms the orgs/ watch when boot could not, then rescans. */
  resume(slugs: string[]): Promise<void>;
}

const RESCAN_DEBOUNCE_MS = 2000;
export const PAUSE_SETTLE_MS = 30_000;


const PACK_HOLDS_NS = "pack-holds";

function originOf(dir: string): string | null {
  try {
    return parseOriginUrl(readFileSync(join(dir, ".git", "config"), "utf8"));
  } catch {
    return null;
  }
}

const parkedWarned = new Set<string>();
export function __resetParkedWarnings(): void {
  parkedWarned.clear();
}

/** Orgs whose generated folder changed and some config dir has not yet been re-pointed at it: an unchanged pull would otherwise never try again. */
const registrationPending = new Set<string>();
export function __resetPendingRegistrations(): void {
  registrationPending.clear();
}

/** Claude may record the path it was given or its realpath (macOS tmp folders differ). */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function samePath(a: string, b: string): boolean {
  return real(a) === real(b);
}

/** cswap accounts usually share one `plugins/` folder through a symlink, and that folder is what Claude registers into. */
function distinctConfigDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  return dirs.filter((dir) => {
    const key = real(join(dir, "plugins"));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Registering the generated folder the first time belongs to setup, which
 * also reinstalls the packs from it. The daemon only re-points a config dir
 * whose registration of the name still names another source, so a pull that
 * adds a team reaches a Mac setup has not migrated; a name a config dir does
 * not register at all may be one the member removed, and stays removed.
 * Never throws.
 */
async function refreshGeneratedMarketplace(p: Probes, org: string, log: Logger, write: typeof writeGeneratedMarketplace): Promise<void> {
  let written: Awaited<ReturnType<typeof writeGeneratedMarketplace>>;
  try {
    written = await write(p, org);
  } catch (err) {
    log.warn({ err }, `generated marketplace: could not rewrite it: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (written.skipped) {
    log.debug({ skipped: written.skipped }, "generated marketplace: not written");
    return;
  }
  if (written.changed) {
    registrationPending.add(org);
    log.info({ path: written.path, dropped: written.dropped }, "generated marketplace: rewritten");
  }
  if (!registrationPending.has(org)) return;

  const generatedFile = join(written.path, ".claude-plugin", "marketplace.json");
  const raw = p.readFile(generatedFile);
  let name: string | null = null;
  try {
    const parsed = raw === null ? null : (JSON.parse(raw) as { name?: unknown } | null);
    name = typeof parsed?.name === "string" ? parsed.name : null;
  } catch {
    name = null;
  }
  if (name === null) {
    log.warn({ path: generatedFile, read: raw !== null }, "generated marketplace: could not read its name back, so registration is retried on the next pull");
    return;
  }
  const claude = resolveTool(p, "claude");
  if (name === null || !claude.exec) return;

  const stale: string[] = [];
  for (const configDir of distinctConfigDirs(claudeConfigDirs(p, cswapConfigDirs(p)))) {
    const listed = await p.exec([...claude.exec, "plugin", "marketplace", "list", "--json"], { env: { CLAUDE_CONFIG_DIR: configDir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
    const known = listed.code === 0 ? parseMarketplaceList(listed.stdout) : null;
    if (known === null) {
      log.warn({ configDir, code: listed.code }, "generated marketplace: could not read Claude's marketplace list, so registering it is left to setup");
      return;
    }
    const named = known.filter((m) => m.name === name);
    if (named.length === 0) continue;
    if (named.some((m) => m.source !== null && samePath(m.source, written.path))) continue;
    stale.push(configDir);
  }
  let failed = false;
  for (const configDir of stale) {
    const added = await p.exec([...claude.exec, "plugin", "marketplace", "add", written.path], { env: { CLAUDE_CONFIG_DIR: configDir }, timeoutMs: PACK_EXEC_TIMEOUT_MS });
    if (added.code !== 0 && !isAlready(added)) {
      log.warn({ path: written.path, configDir, detail: claudeMessage(added, `exited ${added.code}`) }, "generated marketplace: claude plugin marketplace add failed");
      failed = true;
      continue;
    }
    log.info({ path: written.path, marketplace: name, configDir }, "generated marketplace: registered");
  }
  if (!failed) registrationPending.delete(org);
}

/**
 * The layout of the clone this pull moved when it is one this rt does not read, else null. orgLayoutState classifies
 * only the clone it picks, which with several clones under orgs/ need not be this one.
 */
function cloneWaitingLayout(p: Probes, slug: string, dir: string): number | null {
  const picked = pickOrgClone([
    { slug, isClone: p.exists(join(dir, ".git", "config")), marker: markerState(p, dir), hasStore: p.exists(join(dir, ORG_STORE_REL)) },
  ]);
  return picked !== null && !pickedCloneReady(picked) ? picked.layout : null;
}

/**
 * A clone parked off the ref keeps the ref's packs, so every pull would otherwise look like a no-op update; one warning per org per daemon. Never throws.
 * `main` is never parked: a clone sits there until the data-branch move runs.
 */
async function warnIfParked(p: Probes, org: string, dir: string): Promise<void> {
  if (parkedWarned.has(org)) return;
  try {
    const ref = generatedMarketplaceRef(p, dir);
    const branch = await checkedOutBranch(p, dir, { timeoutMs: PACK_EXEC_TIMEOUT_MS });
    if (branch === null || branch === ref || branch === "main") return;
    parkedWarned.add(org);
    warn("team-snapshots", `The ${org} org clone is on ${branch}, not ${ref}, so its team packs stay at ${ref}'s versions until it is back on ${ref}`, {
      context: { org, branch, ref },
    });
  } catch {
    /* a branch git cannot name is not a parked clone */
  }
}

/** The generated marketplace is rewritten first (a pull can add a team), then the converge, then a pack it changed gets the member's disabled skills back, then the clone's cone follows the role, then the post-pull hooks; the cone and the hooks run even when the converge threw, and a cone that failed never fails the pull. On an org layout this rt does not read, only the cone and the hooks run. */
export function createOnPulled(opts: {
  probes: Probes;
  slug: string;
  dir: string;
  log: Logger;
  converge: typeof convergePackCache;
  /** Injectable so a test can order it against the converge. */
  writeMarketplace?: typeof writeGeneratedMarketplace;
  afterPull?: (slug: string) => Promise<void>;
  applyCone?: typeof applyRoleCone;
  /** Injectable so a test can stand in for a daemon whose settings will not read. */
  readChoices?: () => Record<string, string[]>;
  /** Remembers which held pack versions were already logged; defaults to the state db's kv table. */
  holds?: { has(key: string): boolean; mark(key: string): void };
}): () => Promise<void> {
  const holds = opts.holds ?? {
    has: (key: string) => hasKvValue(PACK_HOLDS_NS, key),
    mark: (key: string) => setKvValue(PACK_HOLDS_NS, key, { at: Date.now() }),
  };
  const applyCone = async (): Promise<void> => {
    try {
      const { kept } = await (opts.applyCone ?? applyRoleCone)(opts.probes, opts.dir, opts.slug);
      if (kept.length > 0) opts.log.info({ kept }, "cone: team folders kept because they hold changes");
    } catch (err) {
      opts.log.warn({ err }, "cone: could not apply the role's sparse checkout");
    }
  };
  // An empty read means the store is absent or unreadable, and either way there is nothing to put back.
  const reapplyDisabledSkills = (): void => {
    try {
      const choices = (opts.readChoices ?? readDisableModelInvocationChoices)();
      if (Object.keys(choices).length === 0) return;
      const { warnings } = reconcileDisableModelInvocation({ configDirs: disableModelInvocationConfigDirs(opts.probes.env, opts.probes.home), choices });
      for (const warning of warnings) opts.log.warn({ warning }, `disable-model-invocation: ${warning}`);
    } catch (err) {
      opts.log.warn({ err }, `disable-model-invocation: could not reapply after a pack update: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return async () => {
    try {
      // The pull gate holds only a tip above the readable layouts, so a clone below them still reaches here.
      const waitingLayout = cloneWaitingLayout(opts.probes, opts.slug, opts.dir);
      if (waitingLayout !== null) {
        opts.log.debug({ layout: waitingLayout }, "team packs: left as they are; the org is on a layout this rt does not read");
        return;
      }
      await refreshGeneratedMarketplace(opts.probes, opts.slug, opts.log, opts.writeMarketplace ?? writeGeneratedMarketplace);
      await warnIfParked(opts.probes, opts.slug, opts.dir);
      const result = await opts.converge(opts.probes, opts.slug, opts.log);
      if (result.updated.length > 0 || result.installed.length > 0) reapplyDisabledSkills();
      for (const h of result.held) {
        const key = `${h.id}@${h.to}`;
        let seen = false;
        try {
          seen = holds.has(key);
        } catch (err) {
          opts.log.warn({ err, key }, "pack hold dedupe unreadable; logging the hold again");
        }
        if (seen) continue;
        opts.log.info({ ...h }, "pack held: this app's engine is below its floor");
        try {
          holds.mark(key);
        } catch (err) {
          opts.log.warn({ err, key }, "pack hold could not be remembered");
        }
      }
    } finally {
      await applyCone();
      await opts.afterPull?.(opts.slug);
    }
  };
}

/** The move a moved hold asks for. Never throws: the pull stays held and the next one tries again. A hold is logged once until it changes. */
export function createOnMoved(opts: {
  probes: Probes;
  dir: string;
  log: Logger;
  moveData: typeof convergeDataBranch;
  readToken?: (p: Probes, remote: string) => Promise<string | null>;
}): () => Promise<void> {
  let loggedHold: string | null = null;
  return async () => {
    try {
      const result = await opts.moveData(opts.probes, opts.dir, opts.readToken ? { readToken: opts.readToken } : {});
      if (result?.kind === "held" || result?.kind === "unchecked") {
        const key = JSON.stringify(result);
        if (key !== loggedHold) {
          if (result.kind === "held") opts.log.info({ ...result }, "data branch: the move is held until the clone can move");
          else opts.log.info({ log: result.log }, "data branch: could not ask origin whether the data moved; trying again next pull");
        }
        loggedHold = key;
        return;
      }
      loggedHold = null;
      if (result?.kind === "moved") opts.log.info({ branch: result.branch, carried: result.carried ?? 0 }, "data branch: moved the clone to the org's data branch");
      if (result?.kind === "failed") opts.log.warn({ log: result.log }, `data branch: could not move the clone: ${result.log}`);
    } catch (err) {
      opts.log.warn({ err }, `data branch: the move threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
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
  const moveData = rawDeps.moveData ?? convergeDataBranch;
  const instances = new Map<string, { handle: SnapshotHandle; dir: string; owned: string }>();
  const held = new Set<string>();
  const skippedNoRemote = new Set<string>();
  const instanceOf = (slug: string) => {
    const inst = instances.get(slug);
    if (!inst) throw new UserActionableError("no-team", `team "${slug}" is not cloned locally (or has no origin)`);
    return inst;
  };
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
          onPulled: createOnPulled({ probes, slug, dir, log: rawDeps.log.child({ team: slug }), converge, afterPull: rawDeps.afterPull }),
          onMoved: createOnMoved({ probes, dir, log: rawDeps.log.child({ team: slug }), moveData, readToken: rawDeps.readToken }),
          ...(rawDeps.readToken ? { readToken: rawDeps.readToken } : {}),
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
      return instanceOf(slug).handle.pullNow();
    },
    async moveNow(slug) {
      const inst = instanceOf(slug);
      return inst.handle.locked(() => moveData(probes, inst.dir, rawDeps.readToken ? { readToken: rawDeps.readToken } : {}));
    },
  };
}
