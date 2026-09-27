import { describe, expect, test } from "bun:test";
import type { FetchOptions, FetchState, GitClient, RepoSnapshot } from "../../../packages/git-core/src/index.ts";
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
  const calls = { snapshot: 0, fetch: 0, signals: [] as (AbortSignal | undefined)[], opts: [] as (FetchOptions | undefined)[] };
  const client = {
    snapshot: async () => opts.snapshots[Math.min(calls.snapshot++, opts.snapshots.length - 1)]!,
    fetchState: async () => opts.fetchState,
    remotes: async () => opts.remotes ?? [{ name: "origin" }],
    fetch: async (_remote?: string, signal?: AbortSignal, fetchOpts?: FetchOptions) => {
      calls.fetch++;
      calls.signals.push(signal);
      calls.opts.push(fetchOpts);
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

  test("the background fetch never prompts on the board's terminal", async () => {
    const { client, calls } = fakeClient({ snapshots: [snap()], fetchState: { lastFetchedAt: null } });
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW }, collect().publish);
    expect(calls.opts).toEqual([{ nonInteractive: true }]);
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

  test("the stop signal aborts an in-flight fetch", async () => {
    const stop = new AbortController();
    const { client, calls } = fakeClient({
      snapshots: [snap()],
      fetchState: { lastFetchedAt: null },
      fetch: (signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    });
    const { published, publish } = collect();
    const done = refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW, signal: stop.signal }, publish);
    while (calls.fetch === 0) await Promise.resolve();
    stop.abort();
    await done;
    expect(calls.signals[0]?.aborted).toBe(true);
    expect(published).toHaveLength(1);
  });

  test("an already-stopped refresh never starts a fetch", async () => {
    const stop = new AbortController();
    stop.abort();
    const { client, calls } = fakeClient({ snapshots: [snap()], fetchState: { lastFetchedAt: null } });
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW, signal: stop.signal }, publish);
    expect(calls.fetch).toBe(0);
    expect(published).toHaveLength(1);
  });

  test("a snapshot that throws publishes null", async () => {
    const client = { snapshot: async () => { throw new Error("not a git repo"); }, fetchState: async () => ({ lastFetchedAt: null }) } as unknown as GitClient;
    const { published, publish } = collect();
    await refreshIndicator(TARGET, { client: () => client, pathExists: () => true, now: () => NOW }, publish);
    expect(published).toEqual([["path:/r/a", null]]);
  });
});
