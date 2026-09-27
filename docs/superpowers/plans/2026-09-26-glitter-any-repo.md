# glitter: any repo, no registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt glitter` opens on any git repo, lists every repo the `rt cd` scan finds, keeps unregistered repos' badges fresh the way GitHub Desktop does, and never registers a repo.

**Architecture:** Glitter stops using the dispatcher's `context: "repo"` (which registers) and resolves its start repo read-only. The driver merges the daemon's `repos:status` rows with unregistered rows read from the daemon-warmed cd cache, and a port of GitHub Desktop's `RepositoryIndicatorUpdater` badges the unregistered ones one at a time using the git-core calls glitter already makes for the open repo. rt-ui reports terminal focus so the updater pauses while the board is unfocused.

**Tech Stack:** Bun + TypeScript (`bun:test`), Go + Bubble Tea v2 (rt-ui), git-core (`packages/git-core`), state.db kv.

**Spec:** `docs/superpowers/specs/2026-09-26-glitter-any-repo-design.md`

## Global Constraints

- Nothing glitter runs may call `getRepoIdentity`, `getRepoIdentityForRoot`, `requireRepoIdentity`, `requireIdentity` or `updateRepoIndex`. Identity comes from `identityForRootReadOnly` only.
- No new daemon command, no change to `lib/daemon/git-status-sweep.ts` or any daemon handler.
- Pacing constants (from GitHub Desktop): first pass 2 minutes after start, pass interval 15 minutes, skew up to 30 seconds, background fetch at most once per 30 minutes per repo, fetch abort after 60 seconds.
- One unregistered repo refreshes at a time. Registered repos and the open repo are never refreshed by the updater.
- Last-opened repo lives in state.db kv, namespace `glitter`, key `lastRepo`, value `{ identity, worktree }`. Never in settings.
- Run `bun test` from the repo root only (bunfig preload). Go tests run from `ui/`.
- No em dashes or en dashes in code, comments, commits or copy.
- Comments only for constraints the code cannot show; no narration, no process references.
- The TypeScript CLI stays UI-free (no JSX, no UI frameworks); all rendering stays in rt-ui.

## Review Focus

1. A scanned repo deleted since the cd cache was written: its badge must drop and switching to it must refuse with a notice, not crash (Task 1 test "missing path", Task 5 test "refuses a vanished unregistered repo").
2. An unregistered repo with no `origin` remote: no fetch is attempted and its badge still shows local status (Task 1 test "no origin").
3. A fetch that hangs: it is aborted after the timeout and the pass moves on to the next repo (Task 1 test "hung fetch").
4. A repo that got registered after the cd cache was written (present in both sources): it appears once, with the daemon's badge, and the updater skips it (Task 3 test "registered wins").
5. Switching to an unregistered repo in the middle of a pass: the updater must not also refresh the now-open repo (Task 2 test "targets are re-read per repo", Task 5 test "skips the open repo").

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/mission/indicator-refresh.ts` (new) | One repo: exists check, snapshot, badge, gated fetch, re-badge. |
| `lib/mission/indicator-updater.ts` (new) | Pacing: delay, cadence, skew, one-at-a-time, pause/resume. Port of GitHub Desktop's updater. |
| `lib/mission/repo-list.ts` (new) | Unregistered rows from the cd cache; merge with `repos:status` rows. |
| `lib/mission/launch.ts` (new) | Start-repo resolution and `lastRepo` kv read/write. |
| `lib/mission/driver.ts` | Wires the three modules, focus intent, provision refusal, `unmanaged` flag. |
| `lib/mission/model.ts`, `lib/ui/protocol.ts` | `current.unmanaged` on the wire model. |
| `commands/glitter.ts`, `lib/command-tree-def.ts` | Read-only launch; drop `context: "repo"`. |
| `ui/internal/views/mission/{model,modal,mission}.go` | `Unmanaged` hides provisioning; focus reporting emits `mission:focus`. |
| `ui/fixtures/session-model-mission.json` | Gains `current.unmanaged`. |
| `e2e/pty/glitter.test.ts` | Whole-binary no-registration gate. |

---

### Task 1: Per-repo indicator refresh

**Files:**
- Create: `lib/mission/indicator-refresh.ts`
- Test: `lib/mission/__tests__/indicator-refresh.test.ts`

**Interfaces:**
- Consumes: `GitClient` (`packages/git-core/src/index.ts`: `snapshot()`, `fetchState()`, `remotes()`, `fetch(remote?, signal?)`), `toBadge(worktree, snap, fetch, updatedAt)` from `lib/git-badge.ts`, `GitWorktreeBadge` from `packages/rt-client/src/commands.ts`.
- Produces:
  ```ts
  export const FETCH_MIN_INTERVAL_MS = 30 * 60_000;
  export const FETCH_TIMEOUT_MS = 60_000;
  export interface IndicatorTarget { id: string; path: string }
  export interface IndicatorRefreshDeps {
    client: (dir: string) => GitClient;
    pathExists: (absPath: string) => boolean;
    now: () => Date;
    fetchTimeoutMs?: number;
  }
  export type PublishBadge = (id: string, badge: GitWorktreeBadge | null) => void;
  export async function refreshIndicator(target: IndicatorTarget, deps: IndicatorRefreshDeps, publish: PublishBadge): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import type { FetchState, GitClient, RepoSnapshot } from "../../../packages/git-core/src/index.ts";
import type { GitWorktreeBadge } from "../../../packages/rt-client/src/commands.ts";
import { refreshIndicator } from "../indicator-refresh.ts";

const NOW = new Date("2026-09-26T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function snap(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return { branch: "main", detached: false, upstream: "origin/main", ahead: 0, behind: 0, files: [], clean: true, ...over };
}

function fakeClient(opts: {
  snapshots: RepoSnapshot[];
  fetchState: FetchState;
  remotes?: { name: string }[];
  fetch?: (signal?: AbortSignal) => Promise<void>;
}) {
  const calls = { snapshot: 0, fetch: 0, signals: [] as (AbortSignal | undefined)[] };
  const client = {
    snapshot: async () => opts.snapshots[Math.min(calls.snapshot++, opts.snapshots.length - 1)]!,
    fetchState: async () => opts.fetchState,
    remotes: async () => opts.remotes ?? [{ name: "origin" }],
    fetch: async (_remote?: string, signal?: AbortSignal) => {
      calls.fetch++;
      calls.signals.push(signal);
      await (opts.fetch?.(signal) ?? Promise.resolve());
    },
  } as unknown as GitClient;
  return { client, calls };
}

function collect() {
  const published: [string, GitWorktreeBadge | null][] = [];
  return { published, publish: (id: string, b: GitWorktreeBadge | null) => { published.push([id, b]); } };
}

const TARGET = { id: "path:/r/a", path: "/r/a" };

describe("refreshIndicator", () => {
  test("missing path publishes null and never touches git", async () => {
    const { client, calls } = fakeClient({ snapshots: [snap()], fetchState: { lastFetchedAt: null } });
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => false, now: () => NOW }, publish);
    expect(published).toEqual([["path:/r/a", null]]);
    expect(calls.snapshot).toBe(0);
  });

  test("recent fetch: one badge, no fetch", async () => {
    const { client, calls } = fakeClient({ snapshots: [snap({ ahead: 2 })], fetchState: { lastFetchedAt: minutesAgo(10) } });
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW }, publish);
    expect(calls.fetch).toBe(0);
    expect(published).toHaveLength(1);
    expect(published[0]![1]!.ahead).toBe(2);
    expect(published[0]![1]!.worktree).toBe("/r/a");
  });

  test("stale fetch with origin: fetches, then republishes from the post-fetch snapshot", async () => {
    const { client, calls } = fakeClient({
      snapshots: [snap({ behind: 0 }), snap({ behind: 3 })],
      fetchState: { lastFetchedAt: minutesAgo(31) },
    });
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW }, publish);
    expect(calls.fetch).toBe(1);
    expect(published.map(([, b]) => b!.behind)).toEqual([0, 3]);
  });

  test("never fetched counts as stale", async () => {
    const { client, calls } = fakeClient({ snapshots: [snap()], fetchState: { lastFetchedAt: null } });
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW }, collect().publish);
    expect(calls.fetch).toBe(1);
  });

  test("no origin: no fetch, local badge still published", async () => {
    const { client, calls } = fakeClient({ snapshots: [snap()], fetchState: { lastFetchedAt: null }, remotes: [{ name: "upstream" }] });
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW }, publish);
    expect(calls.fetch).toBe(0);
    expect(published).toHaveLength(1);
  });

  test("failed fetch keeps the first badge and does not republish", async () => {
    const { client } = fakeClient({
      snapshots: [snap()],
      fetchState: { lastFetchedAt: null },
      fetch: async () => { throw new Error("auth failed"); },
    });
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW }, publish);
    expect(published).toHaveLength(1);
  });

  test("hung fetch is aborted at the timeout and the call returns", async () => {
    const { client, calls } = fakeClient({
      snapshots: [snap()],
      fetchState: { lastFetchedAt: null },
      fetch: (signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    });
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW, fetchTimeoutMs: 20 }, publish);
    expect(calls.signals[0]?.aborted).toBe(true);
    expect(published).toHaveLength(1);
  });

  test("a snapshot that throws publishes null", async () => {
    const client = { snapshot: async () => { throw new Error("not a git repo"); }, fetchState: async () => ({ lastFetchedAt: null }) } as unknown as GitClient;
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW }, publish);
    expect(published).toEqual([["path:/r/a", null]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/mission/__tests__/indicator-refresh.test.ts`
Expected: FAIL, cannot resolve `../indicator-refresh.ts`.

- [ ] **Step 3: Implement**

```ts
import type { GitClient } from "../../packages/git-core/src/index.ts";
import type { GitWorktreeBadge } from "../../packages/rt-client/src/commands.ts";
import { toBadge } from "../git-badge.ts";

export const FETCH_MIN_INTERVAL_MS = 30 * 60_000;
export const FETCH_TIMEOUT_MS = 60_000;

export interface IndicatorTarget {
  id: string;
  path: string;
}

export interface IndicatorRefreshDeps {
  client: (dir: string) => GitClient;
  pathExists: (absPath: string) => boolean;
  now: () => Date;
  fetchTimeoutMs?: number;
}

export type PublishBadge = (id: string, badge: GitWorktreeBadge | null) => void;

function fetchIsStale(lastFetchedAt: string | null, now: Date): boolean {
  return lastFetchedAt === null || now.getTime() - Date.parse(lastFetchedAt) >= FETCH_MIN_INTERVAL_MS;
}

async function fetchWithTimeout(client: GitClient, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.fetch(undefined, controller.signal),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("fetch timed out"));
        }, timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshIndicator(target: IndicatorTarget, deps: IndicatorRefreshDeps, publish: PublishBadge): Promise<void> {
  if (!deps.pathExists(target.path)) {
    publish(target.id, null);
    return;
  }
  const client = deps.client(target.path);
  try {
    const [snap, fetch] = await Promise.all([client.snapshot(), client.fetchState()]);
    publish(target.id, toBadge(target.path, snap, fetch, deps.now().toISOString()));
    if (!fetchIsStale(fetch.lastFetchedAt, deps.now())) return;
    const hasOrigin = await client.remotes().then((rs) => rs.some((r) => r.name === "origin"), () => false);
    if (!hasOrigin) return;
    if (!(await fetchWithTimeout(client, deps.fetchTimeoutMs ?? FETCH_TIMEOUT_MS))) return;
    const [after, afterFetch] = await Promise.all([client.snapshot(), client.fetchState()]);
    publish(target.id, toBadge(target.path, after, afterFetch, deps.now().toISOString()));
  } catch {
    publish(target.id, null);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/mission/__tests__/indicator-refresh.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/mission/indicator-refresh.ts lib/mission/__tests__/indicator-refresh.test.ts
git commit -m "mission: per-repo indicator refresh for unregistered repos"
```

---

### Task 2: Indicator updater (pacing)

**Files:**
- Create: `lib/mission/indicator-updater.ts`
- Test: `lib/mission/__tests__/indicator-updater.test.ts`

**Interfaces:**
- Consumes: `IndicatorTarget` from `lib/mission/indicator-refresh.ts` (Task 1).
- Produces:
  ```ts
  export const INITIAL_DELAY_MS = 2 * 60_000;
  export const REFRESH_INTERVAL_MS = 15 * 60_000;
  export const SKEW_MAX_MS = 30_000;
  export interface IndicatorUpdaterDeps {
    targets: () => IndicatorTarget[];
    refreshOne: (target: IndicatorTarget) => Promise<void>;
    onPassStart?: () => void;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
    now: () => number;
    skewMs: number;
  }
  export class IndicatorUpdater { constructor(deps: IndicatorUpdaterDeps); start(): void; stop(): void; pause(): void; resume(): void }
  export function randomSkewMs(): number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import type { IndicatorTarget } from "../indicator-refresh.ts";
import { INITIAL_DELAY_MS, IndicatorUpdater, REFRESH_INTERVAL_MS } from "../indicator-updater.ts";

const SKEW = 1_000;

function harness(initial: IndicatorTarget[]) {
  let targets = initial;
  let now = 0;
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const started: string[] = [];
  const pending: (() => void)[] = [];
  let passStarts = 0;
  const updater = new IndicatorUpdater({
    targets: () => targets,
    refreshOne: (t) => {
      started.push(t.id);
      return new Promise<void>((resolve) => { pending.push(resolve); });
    },
    onPassStart: () => { passStarts++; },
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => { (h as { cleared: boolean }).cleared = true; },
    now: () => now,
    skewMs: SKEW,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    updater, timers, started, pending, flush,
    setTargets: (t: IndicatorTarget[]) => { targets = t; },
    setNow: (n: number) => { now = n; },
    passStarts: () => passStarts,
    finishNext: async () => { pending.shift()!(); await flush(); },
  };
}

const A = { id: "a", path: "/a" };
const B = { id: "b", path: "/b" };
const C = { id: "c", path: "/c" };

describe("IndicatorUpdater", () => {
  test("first pass waits the initial delay plus skew", async () => {
    const h = harness([A]);
    h.updater.start();
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(INITIAL_DELAY_MS + SKEW);
    expect(h.started).toEqual([]);
  });

  test("refreshes one repo at a time, in order", async () => {
    const h = harness([A, B]);
    h.updater.start();
    h.timers[0]!.fn();
    await h.flush();
    expect(h.started).toEqual(["a"]);
    await h.finishNext();
    expect(h.started).toEqual(["a", "b"]);
    expect(h.passStarts()).toBe(1);
  });

  test("schedules the next pass one interval after the last pass started", async () => {
    const h = harness([A]);
    h.updater.start();
    h.setNow(500);
    h.timers[0]!.fn();
    await h.flush();
    h.setNow(2_500);
    await h.finishNext();
    expect(h.timers).toHaveLength(2);
    expect(h.timers[1]!.ms).toBe(REFRESH_INTERVAL_MS - 2_000 + SKEW);
  });

  test("targets are re-read per repo", async () => {
    const h = harness([A, B, C]);
    h.updater.start();
    h.timers[0]!.fn();
    await h.flush();
    h.setTargets([A, C]);
    await h.finishNext();
    expect(h.started).toEqual(["a", "c"]);
  });

  test("pause holds the pass between repos; resume continues it", async () => {
    const h = harness([A, B]);
    h.updater.start();
    h.timers[0]!.fn();
    await h.flush();
    h.updater.pause();
    await h.finishNext();
    expect(h.started).toEqual(["a"]);
    h.updater.resume();
    await h.flush();
    expect(h.started).toEqual(["a", "b"]);
  });

  test("a pass whose timer fires while paused waits for resume", async () => {
    const h = harness([A]);
    h.updater.start();
    h.updater.pause();
    h.timers[0]!.fn();
    await h.flush();
    expect(h.started).toEqual([]);
    h.updater.resume();
    await h.flush();
    expect(h.started).toEqual(["a"]);
  });

  test("stop clears the timer and ends a paused pass without refreshing more", async () => {
    const h = harness([A, B]);
    h.updater.start();
    h.timers[0]!.fn();
    await h.flush();
    h.updater.pause();
    h.updater.stop();
    await h.finishNext();
    expect(h.started).toEqual(["a"]);
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(1);
    expect(h.timers).toHaveLength(1);
  });

  test("a refresh that throws does not end the pass", async () => {
    const started: string[] = [];
    const timers: (() => void)[] = [];
    const updater = new IndicatorUpdater({
      targets: () => [A, B],
      refreshOne: async (t) => { started.push(t.id); if (t.id === "a") throw new Error("boom"); },
      setTimer: (fn) => { timers.push(fn); return fn; },
      clearTimer: () => {},
      now: () => 0,
      skewMs: 0,
    });
    updater.start();
    timers[0]!();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/mission/__tests__/indicator-updater.test.ts`
Expected: FAIL, cannot resolve `../indicator-updater.ts`.

- [ ] **Step 3: Implement**

```ts
import type { IndicatorTarget } from "./indicator-refresh.ts";

export const INITIAL_DELAY_MS = 2 * 60_000;
export const REFRESH_INTERVAL_MS = 15 * 60_000;
export const SKEW_MAX_MS = 30_000;

export function randomSkewMs(): number {
  return Math.ceil(Math.random() * SKEW_MAX_MS);
}

export interface IndicatorUpdaterDeps {
  targets: () => IndicatorTarget[];
  refreshOne: (target: IndicatorTarget) => Promise<void>;
  onPassStart?: () => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  skewMs: number;
}

/** Port of GitHub Desktop's RepositoryIndicatorUpdater (app/src/lib/stores/helpers/repository-indicator-updater.ts). */
export class IndicatorUpdater {
  private running = false;
  private timer: unknown = null;
  private paused = false;
  private pauseWaiter: Promise<void> = Promise.resolve();
  private release: (() => void) | null = null;
  private lastPassStartedAt: number | null = null;

  constructor(private readonly deps: IndicatorUpdaterDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    this.resume();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pauseWaiter = new Promise((resolve) => { this.release = resolve; });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.release?.();
    this.release = null;
  }

  private schedule(): void {
    if (!this.running || this.timer !== null) return;
    const base = this.lastPassStartedAt === null
      ? INITIAL_DELAY_MS
      : Math.max(REFRESH_INTERVAL_MS - (this.deps.now() - this.lastPassStartedAt), 0);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.pass();
    }, base + this.deps.skewMs);
  }

  private async pass(): Promise<void> {
    if (this.paused) await this.pauseWaiter;
    if (!this.running) return;
    this.lastPassStartedAt = this.deps.now();
    this.deps.onPassStart?.();
    const done = new Set<string>();
    let next: IndicatorTarget | undefined;
    while (this.running && (next = this.deps.targets().find((t) => !done.has(t.id))) !== undefined) {
      try {
        await this.deps.refreshOne(next);
      } catch {
        // refreshIndicator already maps git failures to a null badge; anything reaching here is a bug in a caller's publish and must not end the pass.
      }
      done.add(next.id);
      if (this.paused) await this.pauseWaiter;
    }
    this.schedule();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/mission/__tests__/indicator-updater.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/mission/indicator-updater.ts lib/mission/__tests__/indicator-updater.test.ts
git commit -m "mission: GitHub Desktop-paced indicator updater"
```

---

### Task 3: Unregistered repo list and merge

**Files:**
- Create: `lib/mission/repo-list.ts`
- Test: `lib/mission/__tests__/repo-list.test.ts`

**Interfaces:**
- Consumes: `KnownRepo` from `lib/repo-index.ts` (`repoName`, `worktrees[{path}]`, `registered?: boolean`, `missing?: true`), `RepoStatusRow` and `GitWorktreeBadge` from `packages/rt-client/src/commands.ts`.
- Produces:
  ```ts
  export interface UnregisteredRepo { identity: string; path: string }
  export interface RepoListDeps { readCached: () => KnownRepo[]; identityOf: (root: string) => string }
  export function loadUnregisteredRepos(
    deps: RepoListDeps,
    registeredIdentities: Set<string>,
    current: { identity: string; path: string; registered: boolean },
  ): UnregisteredRepo[];
  export function mergeRepoRows(
    statusRows: RepoStatusRow[],
    unregistered: UnregisteredRepo[],
    badges: Map<string, GitWorktreeBadge>,
  ): RepoStatusRow[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import type { GitWorktreeBadge, RepoStatusRow } from "../../../packages/rt-client/src/commands.ts";
import type { KnownRepo } from "../../repo-index.ts";
import { loadUnregisteredRepos, mergeRepoRows } from "../repo-list.ts";

function known(path: string, over: Partial<KnownRepo> = {}): KnownRepo {
  return { repoName: path.split("/").pop()!, worktrees: [{ path, branch: "main", isBare: false }], dataDir: "/d", registered: false, ...over } as KnownRepo;
}

const ids: Record<string, string> = { "/r/a": "gh:me/a", "/r/b": "gh:me/b", "/r/reg": "gh:me/reg", "/r/cur": "path:/r/cur" };
const deps = (rows: KnownRepo[]) => ({ readCached: () => rows, identityOf: (root: string) => ids[root] ?? `path:${root}` });
const NOT_CURRENT = { identity: "gh:me/reg", path: "/r/reg", registered: true };

describe("loadUnregisteredRepos", () => {
  test("keeps only unregistered, present rows, with read-only identities", () => {
    const rows = [known("/r/a"), known("/r/reg", { registered: true }), known("/r/gone", { missing: true })];
    expect(loadUnregisteredRepos(deps(rows), new Set(["gh:me/reg"]), NOT_CURRENT)).toEqual([{ identity: "gh:me/a", path: "/r/a" }]);
  });

  test("registered wins: a scanned row whose identity has a status row is dropped", () => {
    const rows = [known("/r/a"), known("/r/b")];
    expect(loadUnregisteredRepos(deps(rows), new Set(["gh:me/b"]), NOT_CURRENT).map((r) => r.identity)).toEqual(["gh:me/a"]);
  });

  test("an identityOf that throws skips that row", () => {
    const d = { readCached: () => [known("/r/a"), known("/r/bad")], identityOf: (root: string) => { if (root === "/r/bad") throw new Error("x"); return ids[root]!; } };
    expect(loadUnregisteredRepos(d, new Set(), NOT_CURRENT).map((r) => r.path)).toEqual(["/r/a"]);
  });

  test("dedupes two paths that resolve to one identity (first wins)", () => {
    const d = { readCached: () => [known("/r/a"), known("/r/a-copy")], identityOf: () => "gh:me/a" };
    expect(loadUnregisteredRepos(d, new Set(), NOT_CURRENT)).toEqual([{ identity: "gh:me/a", path: "/r/a" }]);
  });

  test("an unregistered current repo is always present, even when the cache predates it", () => {
    const got = loadUnregisteredRepos(deps([known("/r/a")]), new Set(), { identity: "path:/r/cur", path: "/r/cur", registered: false });
    expect(got).toContainEqual({ identity: "path:/r/cur", path: "/r/cur" });
  });

  test("a registered current repo is not added", () => {
    const got = loadUnregisteredRepos(deps([]), new Set(), { identity: "gh:me/reg", path: "/r/reg", registered: true });
    expect(got).toEqual([]);
  });
});

describe("mergeRepoRows", () => {
  const status: RepoStatusRow[] = [{ repo: "gh:me/reg", worktrees: [], error: null }];
  const b = { worktree: "/r/a", ahead: 1 } as GitWorktreeBadge;

  test("unregistered rows join sorted by identity, with their badge when known", () => {
    const merged = mergeRepoRows(status, [{ identity: "gh:me/a", path: "/r/a" }, { identity: "gh:me/z", path: "/r/z" }], new Map([["gh:me/a", b]]));
    expect(merged.map((r) => r.repo)).toEqual(["gh:me/a", "gh:me/reg", "gh:me/z"]);
    expect(merged[0]!.worktrees).toEqual([b]);
    expect(merged[2]!.worktrees).toEqual([]);
  });

  test("a status row with the same identity wins over an unregistered one", () => {
    const merged = mergeRepoRows(status, [{ identity: "gh:me/reg", path: "/r/reg" }], new Map([["gh:me/reg", b]]));
    expect(merged).toEqual(status);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/mission/__tests__/repo-list.test.ts`
Expected: FAIL, cannot resolve `../repo-list.ts`.

- [ ] **Step 3: Implement**

```ts
import type { GitWorktreeBadge, RepoStatusRow } from "../../packages/rt-client/src/commands.ts";
import type { KnownRepo } from "../repo-index.ts";

export interface UnregisteredRepo {
  identity: string;
  path: string;
}

export interface RepoListDeps {
  readCached: () => KnownRepo[];
  identityOf: (root: string) => string;
}

export function loadUnregisteredRepos(
  deps: RepoListDeps,
  registeredIdentities: Set<string>,
  current: { identity: string; path: string; registered: boolean },
): UnregisteredRepo[] {
  const seen = new Set<string>();
  const out: UnregisteredRepo[] = [];
  const add = (identity: string, path: string) => {
    if (registeredIdentities.has(identity) || seen.has(identity)) return;
    seen.add(identity);
    out.push({ identity, path });
  };
  for (const row of deps.readCached()) {
    if (row.registered !== false || row.missing) continue;
    const path = row.worktrees[0]?.path;
    if (!path) continue;
    let identity: string;
    try {
      identity = deps.identityOf(path);
    } catch {
      continue;
    }
    add(identity, path);
  }
  if (!current.registered) add(current.identity, current.path);
  return out;
}

export function mergeRepoRows(
  statusRows: RepoStatusRow[],
  unregistered: UnregisteredRepo[],
  badges: Map<string, GitWorktreeBadge>,
): RepoStatusRow[] {
  const have = new Set(statusRows.map((r) => r.repo));
  const extra: RepoStatusRow[] = unregistered
    .filter((u) => !have.has(u.identity))
    .map((u) => {
      const badge = badges.get(u.identity);
      return { repo: u.identity, worktrees: badge ? [badge] : [], error: null };
    });
  return [...statusRows, ...extra].sort((a, b) => a.repo.localeCompare(b.repo));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/mission/__tests__/repo-list.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/mission/repo-list.ts lib/mission/__tests__/repo-list.test.ts
git commit -m "mission: unregistered repo rows from the cd cache"
```

---

### Task 4: Read-only launch and last-opened repo

**Files:**
- Create: `lib/mission/launch.ts`
- Modify: `commands/glitter.ts` (whole `glitterCommand` start section), `lib/command-tree-def.ts` (the `glitter` node, around line 1047)
- Test: `lib/mission/__tests__/launch.test.ts`

**Interfaces:**
- Consumes: `getKvValue`, `setKvValue` from `lib/state/kv-blob.ts`; `identityForRootReadOnly` from `lib/repo.ts`; `getRepoRoot` from `lib/git.ts`; `getKnownReposCached`, `repoOptions`, `repoFromOptionValue` from `lib/repo-index.ts` (re-exported by `lib/repo.ts`); `filterableSelect` from `lib/pick-wrappers.ts`.
- Produces:
  ```ts
  export const LAST_REPO_NS = "glitter";
  export const LAST_REPO_KEY = "lastRepo";
  export interface LastRepo { identity: string; worktree: string }
  export interface LaunchDeps {
    repoRoot: () => string | null;
    identityOf: (root: string) => string;
    readLast: () => LastRepo | null;
    pathExists: (p: string) => boolean;
    pick: () => Promise<string | null>;
  }
  export type LaunchResult = { kind: "start"; repo: string; worktree: string } | { kind: "cancelled" };
  export async function resolveGlitterStart(deps: LaunchDeps): Promise<LaunchResult>;
  export function readLastRepo(): LastRepo | null;
  export function writeLastRepo(value: LastRepo): void;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { resolveGlitterStart, type LaunchDeps } from "../launch.ts";

function deps(over: Partial<LaunchDeps> = {}): LaunchDeps & { picks: number } {
  const d = {
    picks: 0,
    repoRoot: () => null,
    identityOf: (root: string) => `path:${root}`,
    readLast: () => null,
    pathExists: () => true,
    pick: async () => { d.picks++; return "/picked"; },
    ...over,
  };
  return d;
}

describe("resolveGlitterStart", () => {
  test("inside a repo: that repo, never the last one or the picker", async () => {
    const d = deps({ repoRoot: () => "/here", readLast: () => ({ identity: "path:/last", worktree: "/last" }) });
    expect(await resolveGlitterStart(d)).toEqual({ kind: "start", repo: "path:/here", worktree: "/here" });
    expect(d.picks).toBe(0);
  });

  test("outside a repo: the last-opened repo when its worktree exists", async () => {
    const d = deps({ readLast: () => ({ identity: "gh:me/a", worktree: "/last" }) });
    expect(await resolveGlitterStart(d)).toEqual({ kind: "start", repo: "gh:me/a", worktree: "/last" });
  });

  test("a stale last repo falls through to the picker", async () => {
    const d = deps({ readLast: () => ({ identity: "gh:me/a", worktree: "/gone" }), pathExists: (p) => p !== "/gone" });
    expect(await resolveGlitterStart(d)).toEqual({ kind: "start", repo: "path:/picked", worktree: "/picked" });
    expect(d.picks).toBe(1);
  });

  test("no last repo: the picker, resolved read-only", async () => {
    const d = deps();
    expect(await resolveGlitterStart(d)).toEqual({ kind: "start", repo: "path:/picked", worktree: "/picked" });
  });

  test("Esc on the picker cancels", async () => {
    expect(await resolveGlitterStart(deps({ pick: async () => null }))).toEqual({ kind: "cancelled" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/mission/__tests__/launch.test.ts`
Expected: FAIL, cannot resolve `../launch.ts`.

- [ ] **Step 3: Implement `lib/mission/launch.ts`**

```ts
import { getKvValue, setKvValue } from "../state/kv-blob.ts";

export const LAST_REPO_NS = "glitter";
export const LAST_REPO_KEY = "lastRepo";

export interface LastRepo {
  identity: string;
  worktree: string;
}

export interface LaunchDeps {
  repoRoot: () => string | null;
  identityOf: (root: string) => string;
  readLast: () => LastRepo | null;
  pathExists: (p: string) => boolean;
  pick: () => Promise<string | null>;
}

export type LaunchResult = { kind: "start"; repo: string; worktree: string } | { kind: "cancelled" };

export async function resolveGlitterStart(deps: LaunchDeps): Promise<LaunchResult> {
  const root = deps.repoRoot();
  if (root) return { kind: "start", repo: deps.identityOf(root), worktree: root };
  const last = deps.readLast();
  if (last && deps.pathExists(last.worktree)) return { kind: "start", repo: last.identity, worktree: last.worktree };
  const picked = await deps.pick();
  if (!picked) return { kind: "cancelled" };
  return { kind: "start", repo: deps.identityOf(picked), worktree: picked };
}

export function readLastRepo(): LastRepo | null {
  const v = getKvValue<LastRepo | null>(LAST_REPO_NS, LAST_REPO_KEY, null);
  return v && typeof v.identity === "string" && typeof v.worktree === "string" ? v : null;
}

export function writeLastRepo(value: LastRepo): void {
  setKvValue(LAST_REPO_NS, LAST_REPO_KEY, value);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/mission/__tests__/launch.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Drop the registering context from the command node**

In `lib/command-tree-def.ts`, the `glitter` node: delete the line `context: "repo",`. Leave every other field.

- [ ] **Step 6: Wire `commands/glitter.ts`**

Replace the `if (!ctx.identity) { ... }` block and the two `const currentRepo / currentWorktree` lines with:

```ts
  const start = await resolveGlitterStart({
    repoRoot: () => getRepoRoot(),
    identityOf: identityForRootReadOnly,
    readLast: readLastRepo,
    pathExists: existsSync,
    pick: pickRepoRoot,
  });
  if (start.kind === "cancelled") return exit(0);
```

and construct the driver with `{ repo: start.repo, worktree: start.worktree }`. Rename the unused `ctx` parameter to `_ctx`. Add this helper to the same file:

```ts
async function pickRepoRoot(): Promise<string | null> {
  const repos = getKnownReposCached({ includeMissing: false });
  if (repos.length === 0) {
    process.stderr.write("rt glitter: not in a git repo and no repos found under your repo roots\n");
    return null;
  }
  const picked = await filterableSelect({ message: "Pick a repo for rt glitter", options: repoOptions(repos), breadcrumb: ["rt", "glitter"] });
  if (!picked) return null;
  return repoFromOptionValue(repos, picked)?.worktrees[0]?.path ?? null;
}
```

Imports to add: `getRepoRoot` from `../lib/git.ts`; `identityForRootReadOnly`, `getKnownReposCached`, `repoOptions`, `repoFromOptionValue` from `../lib/repo.ts`; `filterableSelect` from `../lib/pick-wrappers.ts`; `resolveGlitterStart`, `readLastRepo` from `../lib/mission/launch.ts`.

- [ ] **Step 7: Run the command-tree gates**

Run: `bun test lib/__tests__/picker-conformance.test.ts lib/__tests__/agent-safe.test.ts lib/__tests__/no-eager-tui.test.ts && bun run picker:check`
Expected: PASS. (`glitter` has no positional args, so no `omitBehavior` is needed.)

- [ ] **Step 8: Commit**

```bash
git add lib/mission/launch.ts lib/mission/__tests__/launch.test.ts commands/glitter.ts lib/command-tree-def.ts
git commit -m "glitter: open any repo read-only; remember the last one"
```

---

### Task 5: Driver wiring

**Files:**
- Modify: `lib/mission/driver.ts` (`MissionDeps`, fields, `run()`, `refresh()`, `refreshBadges()`, `model()`, `currentRepoBadges()`, `handle()` switch, `handleRepo()`, `provisionWorktree()`)
- Modify: `lib/ui/protocol.ts:298` (`MissionCurrent`), `lib/mission/model.ts` (`buildModel` input and `current`)
- Modify: `commands/glitter.ts` (new deps)
- Test: `lib/mission/__tests__/driver.test.ts` (extend `baseDeps`, add a `describe`)

**Interfaces:**
- Consumes: Tasks 1 to 4 exports.
- Produces:
  ```ts
  // MissionDeps additions
  readRepoCache: () => KnownRepo[];
  identityOf: (root: string) => string;
  isRegistered: (identity: string) => boolean;
  saveLastRepo: (value: LastRepo) => void;
  indicatorTimers: { setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (h: unknown) => void; skewMs: number };
  // MissionCurrent addition (lib/ui/protocol.ts)
  unmanaged: boolean;
  // buildModel input addition (lib/mission/model.ts)
  unmanaged?: boolean;
  // new intent
  "mission:focus" with payload { focused: boolean }
  ```

- [ ] **Step 1: Extend `baseDeps` in `driver.test.ts`**

Add to the `over` parameter type: `readRepoCache?`, `identityOf?`, `isRegistered?`, `saveLastRepo?`, `indicatorTimers?` (each `MissionDeps[...]`). Add to the returned object:

```ts
    readRepoCache: over.readRepoCache ?? (() => []),
    identityOf: over.identityOf ?? ((root: string) => `path:${root}`),
    isRegistered: over.isRegistered ?? (() => true),
    saveLastRepo: over.saveLastRepo ?? (() => {}),
    indicatorTimers: over.indicatorTimers ?? { setTimer: () => null, clearTimer: () => {}, skewMs: 0 },
```

`isRegistered` defaults to `true` so every existing test keeps today's behavior.

- [ ] **Step 2: Write the failing tests**

Append to `driver.test.ts`:

```ts
describe("unregistered repos", () => {
  const cacheRow = (path: string) => ({ repoName: path, worktrees: [{ path, branch: "main", isBare: false }], dataDir: "/d", registered: false });
  const ids: Record<string, string> = { "/u/a": "gh:me/a", "/u/b": "gh:me/b" };
  const identityOf = (root: string) => ids[root] ?? `path:${root}`;

  test("lists scanned unregistered repos next to the daemon's rows", async () => {
    const session = new FakeSession([{ t: "intent", name: "quit" }]);
    const deps = baseDeps({ session, readRepoCache: () => [cacheRow("/u/a")], identityOf });
    await new MissionDriver(deps, START).run();
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.repos.map((r) => r.id)).toEqual(["gh:me/a", "repo-tools"]);
  });

  test("switches to an unregistered repo before its first badge", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:repo", payload: { repo: "gh:me/a" } },
      { t: "intent", name: "quit" },
    ]);
    const saved: unknown[] = [];
    const deps = baseDeps({ session, readRepoCache: () => [cacheRow("/u/a")], identityOf, pathExists: () => true, saveLastRepo: (v) => { saved.push(v); } });
    await new MissionDriver(deps, START).run();
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.current.repo).toBe("gh:me/a");
    expect(last.current.worktree).toBe("/u/a");
    expect(last.current.unmanaged).toBe(true);
    expect(saved.at(-1)).toEqual({ identity: "gh:me/a", worktree: "/u/a" });
  });

  test("refuses a vanished unregistered repo", async () => {
    const session = new FakeSession([
      { t: "intent", name: "mission:repo", payload: { repo: "gh:me/a" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({ session, readRepoCache: () => [cacheRow("/u/a")], identityOf, pathExists: () => false });
    await new MissionDriver(deps, START).run();
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.current.repo).toBe("repo-tools");
    expect(last.notice).toBe("no known worktree for gh:me/a");
  });

  test("the updater skips registered repos and the open repo, and publishes badges", async () => {
    const timers: (() => void)[] = [];
    const refreshed: string[] = [];
    const client = makeFakeClient();
    const session = new QueueSession();
    const deps = baseDeps({
      session,
      client,
      readRepoCache: () => [cacheRow("/u/a"), cacheRow("/u/b"), cacheRow("/repo")],
      identityOf: (root) => (root === "/repo" ? "repo-tools" : identityOf(root)),
      pathExists: (p) => { refreshed.push(p); return true; },
      indicatorTimers: { setTimer: (fn) => { timers.push(fn); return fn; }, clearTimer: () => {}, skewMs: 0 },
    });
    const run = new MissionDriver(deps, START).run();
    await flushMicrotasks();
    timers[0]!();
    await flushMicrotasks();
    session.send({ t: "intent", name: "quit" });
    await run;
    expect(refreshed.filter((p) => p.startsWith("/u/") || p === "/repo")).toEqual(["/u/a", "/u/b"]);
    const last = session.pushed.at(-1) as MissionModel;
    expect(last.repos.find((r) => r.id === "gh:me/a")!.badge).toBeDefined();
  });

  test("mission:focus pauses and resumes the updater", async () => {
    const timers: (() => void)[] = [];
    const refreshed: string[] = [];
    const session = new QueueSession();
    const deps = baseDeps({
      session,
      readRepoCache: () => [cacheRow("/u/a")],
      identityOf,
      pathExists: (p) => { refreshed.push(p); return true; },
      indicatorTimers: { setTimer: (fn) => { timers.push(fn); return fn; }, clearTimer: () => {}, skewMs: 0 },
    });
    const run = new MissionDriver(deps, START).run();
    await flushMicrotasks();
    session.send({ t: "intent", name: "mission:focus", payload: { focused: false } });
    await flushMicrotasks();
    timers[0]!();
    await flushMicrotasks();
    expect(refreshed.filter((p) => p === "/u/a")).toEqual([]);
    session.send({ t: "intent", name: "mission:focus", payload: { focused: true } });
    await flushMicrotasks();
    expect(refreshed.filter((p) => p === "/u/a")).toEqual(["/u/a"]);
    session.send({ t: "intent", name: "quit" });
    await run;
  });

  test("provisioning in an unmanaged repo is refused without asking the daemon", async () => {
    const queried: string[] = [];
    const session = new FakeSession([
      { t: "intent", name: "mission:worktree", payload: { new: true, name: "feat" } },
      { t: "intent", name: "quit" },
    ]);
    const deps = baseDeps({
      session,
      isRegistered: () => false,
      daemonQuery: async (cmd: string) => { queried.push(cmd); return { ok: true, data: { repos: [], trees: [] } }; },
    });
    await new MissionDriver(deps, START).run();
    expect(queried).not.toContain("worktree:provision");
    expect((session.pushed.at(-1) as MissionModel).notice).toBe("worktree provisioning needs a repo rt manages");
  });
});
```

`QueueSession` (`lib/mission/__tests__/fake-sessions.ts`) takes no intents up front and is fed with `send()`; `makeFakeClient()` already stubs `snapshot`, `fetchState`, `remotes` and a no-op `fetch`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test lib/mission/__tests__/driver.test.ts -t "unregistered repos"`
Expected: FAIL (type errors on the new deps, then assertion failures).

- [ ] **Step 4: Add `unmanaged` to the wire model**

`lib/ui/protocol.ts`, in `MissionCurrent` after `settling`:

```ts
  /** The repo is not registered with rt: pool worktrees and provisioning are unavailable. */
  unmanaged: boolean;
```

`lib/mission/model.ts`: add `unmanaged?: boolean;` to `buildModel`'s input type, destructure it, and set `unmanaged: input.unmanaged ?? false,` in the `current` object.

- [ ] **Step 5: Implement the driver changes**

In `MissionDeps` add the five deps from the Interfaces block (import `KnownRepo` from `../repo-index.ts` and `LastRepo` from `./launch.ts` as types).

New fields on `MissionDriver`:

```ts
  private unregistered: UnregisteredRepo[] = [];
  private indicatorBadges = new Map<string, GitWorktreeBadge>();
  private unmanaged = false;
  private readonly updater: IndicatorUpdater;
```

In the constructor, after `this.state = {...}`:

```ts
    this.updater = new IndicatorUpdater({
      targets: () => this.unregistered
        .filter((u) => u.identity !== this.state.currentRepo)
        .map((u) => ({ id: u.identity, path: u.path })),
      refreshOne: (target) => refreshIndicator(
        target,
        { client: this.deps.client, pathExists: this.deps.pathExists, now: this.deps.now },
        (id, badge) => {
          if (badge) this.indicatorBadges.set(id, badge);
          else this.indicatorBadges.delete(id);
          this.push();
        },
      ),
      onPassStart: () => this.reloadRepoList(),
      setTimer: this.deps.indicatorTimers.setTimer,
      clearTimer: this.deps.indicatorTimers.clearTimer,
      now: () => this.deps.now().getTime(),
      skewMs: this.deps.indicatorTimers.skewMs,
    });
```

New methods:

```ts
  private reloadRepoList(): void {
    this.unregistered = loadUnregisteredRepos(
      { readCached: this.deps.readRepoCache, identityOf: this.deps.identityOf },
      new Set(this.rows.map((r) => r.repo)),
      { identity: this.state.currentRepo, path: this.state.currentWorktree, registered: !this.unmanaged },
    );
  }

  private repoRows(): RepoStatusRow[] {
    return mergeRepoRows(this.rows, this.unregistered, this.indicatorBadges);
  }

  private rememberRepo(): void {
    this.deps.saveLastRepo({ identity: this.state.currentRepo, worktree: this.state.currentWorktree });
  }
```

In `run()`, before the existing `await this.refresh();`:

```ts
    this.unmanaged = !this.deps.isRegistered(this.state.currentRepo);
```

and after that `refresh()` resolves:

```ts
    this.reloadRepoList();
    this.rememberRepo();
```

After `this.session = session;` add `this.updater.start();`. In the `finally` block, first line: `this.updater.stop();`.

In `model()`: pass `rows: this.repoRows()` and `unmanaged: this.unmanaged` to `buildModel`. In `currentRepoBadges()`: read from `this.repoRows()` instead of `this.rows`.

In `handle()`'s switch, next to `case "mission:refresh":`:

```ts
      case "mission:focus": {
        const focused = (intent.payload as { focused?: unknown } | undefined)?.focused;
        if (focused === false) this.updater.pause();
        else if (focused === true) this.updater.resume();
        break;
      }
```

Replace `handleRepo`'s target lookup and switch:

```ts
    const known = this.rows.find((r) => r.repo === payload.repo)?.worktrees[0]?.worktree;
    const scanned = this.unregistered.find((u) => u.identity === payload.repo)?.path;
    const target = known ?? (scanned && this.deps.pathExists(scanned) ? scanned : undefined);
    if (!target) {
      this.state.notice = `no known worktree for ${repoLabel(payload.repo)}`;
      this.push();
      return;
    }
    this.state.currentRepo = payload.repo;
    this.unmanaged = !this.deps.isRegistered(payload.repo);
    this.setCurrentWorktree(target, false);
    this.state.selections = new Map();
    await this.refresh();
    this.rememberRepo();
    this.push();
```

At the top of `provisionWorktree`, after the empty-name return:

```ts
    if (this.unmanaged) {
      this.state.notice = "worktree provisioning needs a repo rt manages";
      this.push();
      return;
    }
```

- [ ] **Step 6: Wire the real deps in `commands/glitter.ts`**

Add to the `deps` object:

```ts
    readRepoCache: () => getKnownReposCached({ includeMissing: false }),
    identityOf: identityForRootReadOnly,
    isRegistered: isRepoRegistered,
    saveLastRepo: writeLastRepo,
    indicatorTimers: {
      setTimer: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      skewMs: randomSkewMs(),
    },
```

Imports: `isRepoRegistered` from `../lib/repo-index.ts`, `writeLastRepo` from `../lib/mission/launch.ts`, `randomSkewMs` from `../lib/mission/indicator-updater.ts`.

- [ ] **Step 7: Run the mission suites**

Run: `bun test lib/mission/`
Expected: PASS, including every pre-existing driver and model test. A model test comparing against `ui/fixtures/session-model-mission.json` will fail on the new `unmanaged` key; Task 6 updates the fixture, so if it fails here, add `"unmanaged": false` to that fixture's `current` object now and rerun.

- [ ] **Step 8: Typecheck and commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add lib/mission/driver.ts lib/mission/model.ts lib/ui/protocol.ts lib/mission/__tests__/driver.test.ts commands/glitter.ts ui/fixtures/session-model-mission.json
git commit -m "mission: list and badge unregistered repos in glitter"
```

---

### Task 6: rt-ui focus reporting and unmanaged provisioning

**Files:**
- Modify: `ui/internal/views/mission/model.go:145` (`Current`), `ui/internal/views/mission/modal.go:171` (`newWorktreeModal`), `ui/internal/views/mission/mission.go` (`Update` switch at line 415, `View` near line 918)
- Modify: `ui/fixtures/session-model-mission.json` (if Task 5 did not already)
- Test: `ui/internal/views/mission/mission_test.go`

**Interfaces:**
- Consumes: `current.unmanaged` (Task 5); the driver's `mission:focus` handler (Task 5).
- Produces: `mission:focus` intents with `{"focused": true|false}`.

- [ ] **Step 1: Write the failing tests**

Append to `mission_test.go`:

```go
func TestWorktreeModalHidesProvisionWhenUnmanaged(t *testing.T) {
	m := Model{Current: Current{Repo: "path:/r", Unmanaged: true}}
	if ms := newWorktreeModal(m); ms.action != nil {
		t.Fatalf("unmanaged repo still offers provisioning")
	}
	m.Current.Unmanaged = false
	if ms := newWorktreeModal(m); ms.action == nil {
		t.Fatalf("managed repo lost provisioning")
	}
}

func TestFocusEventsEmitFocusIntent(t *testing.T) {
	s := s5open(t)
	s.Type("\x1b[O")
	if l := waitIntent(t, s, "mission:focus"); !strings.Contains(l, `"focused":false`) {
		t.Fatalf("blur intent: %q", l)
	}
	s.Type("\x1b[I")
	if l := waitIntent(t, s, "mission:focus"); !strings.Contains(l, `"focused":true`) {
		t.Fatalf("focus intent: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && go test ./internal/views/mission/ -run 'TestWorktreeModalHidesProvisionWhenUnmanaged|TestFocusEventsEmitFocusIntent'`
Expected: FAIL (`Unmanaged` undefined).

- [ ] **Step 3: Implement**

`model.go`, in `Current` after `Settling`:

```go
	Unmanaged    bool   `json:"unmanaged"`
```

`modal.go`, in `newWorktreeModal`, replace the `action := &modalActionRow{...}` statement with:

```go
	var action *modalActionRow
	if !m.Current.Unmanaged {
		action = &modalActionRow{
			label: "Provision new worktree…",
			buildPayload: func(name string) json.RawMessage {
				return mustPayload(worktreeNewPayload{New: true, Name: name})
			},
		}
	}
```

`mission.go`: next to the other payload types add

```go
type focusPayload struct {
	Focused bool `json:"focused"`
}
```

in `Update`'s switch add

```go
	case tea.FocusMsg:
		return m, m.em.Emit(protocol.Intent{Name: "mission:focus", Payload: mustPayload(focusPayload{Focused: true})})
	case tea.BlurMsg:
		return m, m.em.Emit(protocol.Intent{Name: "mission:focus", Payload: mustPayload(focusPayload{Focused: false})})
```

and in `View`, right after `v.MouseMode = tea.MouseModeAllMotion`:

```go
	v.ReportFocus = true
```

Make sure `ui/fixtures/session-model-mission.json`'s `current` object has `"unmanaged": false`.

- [ ] **Step 4: Run the Go suite and rebuild**

Run: `cd ui && go test ./... && cd .. && bun run ui:build`
Expected: PASS; `ui/dist/rt-ui` rebuilt.

- [ ] **Step 5: Commit**

```bash
git add ui/internal/views/mission/model.go ui/internal/views/mission/modal.go ui/internal/views/mission/mission.go ui/internal/views/mission/mission_test.go ui/fixtures/session-model-mission.json
git commit -m "rt-ui: mission reports focus; hide provisioning for unmanaged repos"
```

---

### Task 7: Whole-binary no-registration gate

**Files:**
- Modify: `e2e/pty/glitter.test.ts`

**Interfaces:**
- Consumes: the existing `openBoard()` helper, `createTestHome`, `createGlitterRepo` in that file; everything from Tasks 4 to 6.

- [ ] **Step 1: Write the failing test**

Read `openBoard()` and the quit flow the file's other tests use, then add inside the top-level `describe` (or at file level, matching the file):

```ts
test("opening a repo in glitter does not register it", async () => {
  const { session, repo } = await openBoard();
  // Quit the way the other tests in this file do, then wait for exit.
  await quitBoard(session);
  const home = open!.home;
  const mirror = join(home, ".mattstack", "rt", "repos.json");
  const indexed = existsSync(mirror) ? readFileSync(mirror, "utf8") : "";
  expect(indexed.includes(repo.path)).toBe(false);
});
```

Adjust to the file's real shape: `openBoard` must expose the test HOME path (add `homePath` to its return value and to `open` if it does not already), and `quitBoard` is whatever key sequence the existing tests use to leave the board (reuse, do not invent). Import `readFileSync` from `fs`.

- [ ] **Step 2: Run the pty gate**

Run: `bun test --preload ./e2e/setup.ts --timeout 120000 e2e/pty/glitter.test.ts`
Expected before Tasks 4 to 6: FAIL (the repo path is in `repos.json`). After: PASS, along with every existing glitter pty test.

- [ ] **Step 3: Commit**

```bash
git add e2e/pty/glitter.test.ts
git commit -m "e2e: glitter leaves the repo index untouched"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run every suite that covers this change**

Run from the repo root:

```bash
bun run test > "$TMPDIR/glitter-unit.log" 2>&1; tail -5 "$TMPDIR/glitter-unit.log"
bun run test:pty > "$TMPDIR/glitter-pty.log" 2>&1; tail -5 "$TMPDIR/glitter-pty.log"
(cd ui && go test ./...)
bun run check
```

Expected: all green. A failure that also fails on clean `main` is pre-existing; confirm it against `main` before calling it that.

- [ ] **Step 2: Manual check under an isolated HOME**

Run the built board against a scratch HOME containing two plain git repos under a directory listed in `rt.repoRoots`, launched from outside any repo, and confirm: the picker appears on first launch, both repos are listed, switching to the unregistered one works, `~/.mattstack/rt/repos.json` in the scratch HOME never gains either path, and relaunching from outside a repo reopens the last one. Screenshot or capture the board text for the report. Also time the launch; if loading the repo list (identity per scanned repo) adds more than about 300 ms, report it rather than tuning it here.
