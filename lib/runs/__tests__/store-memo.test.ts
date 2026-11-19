import { Database } from "bun:sqlite";
import { afterEach, expect, spyOn, test } from "bun:test";
import { chmodSync, copyFileSync, renameSync, rmSync, statSync, utimesSync } from "fs";
import { join } from "path";
import type { RunLiveness } from "../attention.ts";
import { __test__, findRunsBySession, listRuns } from "../store.ts";
import { root, seedRun } from "./fixtures.ts";

afterEach(() => { delete process.env.RT_RUNS_ROOT; });

test("a run db replaced at the same path with the same size and mtime is read again", () => {
  const dir = root();
  seedRun(dir, "repoA", "run1", 1000, 1, { status: "done" });
  seedRun(dir, "repoB", "run1", 1000, 1, { status: "failed" });
  const target = join(dir, "repoA", "run1", "state.db");
  const other = join(dir, "repoB", "run1", "state.db");
  utimesSync(target, 1_000_000, 1_000_000);
  expect(listRuns("repoA").map((r) => r.status)).toEqual(["done"]);
  const before = statSync(target);
  expect(statSync(other).size).toBe(before.size);
  // Copied beside the original and renamed over it: the copy is made while
  // the original still holds its inode, so the replacement gets a new one.
  const replacement = `${target}.new`;
  copyFileSync(other, replacement);
  renameSync(replacement, target);
  utimesSync(target, 1_000_000, 1_000_000);
  const after = statSync(target);
  expect(after.ino).not.toBe(before.ino);
  expect([after.mtimeMs, after.size]).toEqual([before.mtimeMs, before.size]);
  expect(listRuns("repoA").map((r) => r.status)).toEqual(["failed"]);
});

test("a transient query failure is not cached: the next list reads the run again", () => {
  const dir = root();
  seedRun(dir, "repoA", "run1", 1000, 1, { status: "done" });
  const original = Database.prototype.query;
  const spy = spyOn(Database.prototype, "query").mockImplementation(function (this: Database, sql: string) {
    if (sql.includes("FROM fields")) throw new Error("database is locked");
    return original.call(this, sql);
  } as typeof Database.prototype.query);
  try {
    expect(listRuns().map((r) => r.ticket)).toEqual([null]);
    expect(findRunsBySession("sess-x")).toEqual([]);
  } finally {
    spy.mockRestore();
  }
  expect(listRuns().map((r) => r.ticket)).toEqual(["ACME-1"]);
  expect(__test__.cachedRunPaths()).toContain(join(dir, "repoA", "run1", "state.db"));
});

test("a full listing drops cache entries for runs that were deleted", () => {
  const dir = root();
  seedRun(dir, "repoA", "run1", 1000, 1, { status: "done" });
  seedRun(dir, "repoA", "run2", 2000, 1, { status: "done" });
  listRuns();
  const gone = join(dir, "repoA", "run1", "state.db");
  expect(__test__.cachedRunPaths()).toContain(gone);
  rmSync(join(dir, "repoA", "run1"), { recursive: true });
  listRuns();
  expect(__test__.cachedRunPaths()).not.toContain(gone);
  expect(__test__.cachedRunPaths()).toContain(join(dir, "repoA", "run2", "state.db"));
});

test("a finished run's db is opened once, then served from the cache", () => {
  const dir = root();
  seedRun(dir, "repoA", "run1", 1000, 1, { status: "done" });
  const openSpy = spyOn(Database.prototype, "query");
  listRuns();                 // first call opens + reads
  const afterFirst = openSpy.mock.calls.length;
  listRuns();                 // second call: files unchanged -> no reopen
  expect(openSpy.mock.calls.length).toBe(afterFirst); // no additional queries for run1
  openSpy.mockRestore();
});

// chmod leaves mtime and size alone, so a reopen would fail and drop the run.
function unreadable<T>(dbPath: string, fn: () => T): T {
  chmodSync(dbPath, 0o000);
  try { return fn(); } finally { chmodSync(dbPath, 0o644); }
}

function liveness(agentName: string): RunLiveness {
  return {
    agentFor: () => ({ pane: "p1", name: agentName, status: "working" }) as never,
    workingSessionPane: () => null,
    workingAgentPane: () => null,
    worktreeActiveAt: () => null,
  };
}

test("a running run whose files have not changed is not reopened", () => {
  const dir = root();
  seedRun(dir, "repoA", "run2", 1000, 1, { status: "running" });
  expect(listRuns().map((r) => r.id)).toEqual(["run2"]);
  const dbPath = join(dir, "repoA", "run2", "state.db");
  expect(unreadable(dbPath, () => listRuns().map((r) => r.id))).toEqual(["run2"]);
});

test("a write that lands only in the -wal is seen on the next list", () => {
  const dir = root();
  seedRun(dir, "repoA", "run3", 1000, 1, { status: "done" });
  const db = new Database(join(dir, "repoA", "run3", "state.db"));
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("UPDATE runs SET pipeline = 'default';");
  expect(listRuns()[0]!.ticket).toBe("ACME-1");
  db.exec("UPDATE fields SET value = 'ACME-2' WHERE key = 'ticket';");
  expect(listRuns()[0]!.ticket).toBe("ACME-2");
  db.close();
});

test("liveness-derived fields are recomputed for a cached run", () => {
  const dir = root();
  seedRun(dir, "repoA", "run4", Date.now() - 60 * 60_000, 1, { status: "running", fields: [{ key: "worktree", value: "/w/run4" }] });
  const quiet: RunLiveness = { ...liveness("x"), agentFor: () => null };
  const first = listRuns(undefined, quiet)[0]!;
  expect(first.agent).toBeNull();
  expect(first.attention.reason).toBe("stale");
  const dbPath = join(dir, "repoA", "run4", "state.db");
  const working: RunLiveness = { ...liveness("worker"), workingAgentPane: () => "p1", workingSessionPane: () => "p1" };
  const second = unreadable(dbPath, () => listRuns(undefined, working)[0]!);
  expect(second.agent).toEqual(working.agentFor(null, null));
  expect(second.attention.needs).toBe(false);
});

test("findRunsBySession does not reopen runs whose files have not changed", () => {
  const dir = root();
  seedRun(dir, "repoA", "run5", 1000, 1, { status: "done", fields: [{ key: "claude-session", value: "sess-a" }] });
  expect(findRunsBySession("sess-b")).toEqual([]);
  const spy = spyOn(Database.prototype, "query");
  expect(findRunsBySession("sess-b")).toEqual([]);
  expect(spy.mock.calls.length).toBe(0);
  spy.mockRestore();
});

test("findRunsBySession sees a session written only to the -wal", () => {
  const dir = root();
  seedRun(dir, "repoA", "run6", 1000, 1, { status: "running", fields: [{ key: "claude-session", value: "sess-a" }] });
  const db = new Database(join(dir, "repoA", "run6", "state.db"));
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("UPDATE runs SET pipeline = 'default';");
  expect(findRunsBySession("sess-c")).toEqual([]);
  db.exec("UPDATE fields SET value = 'sess-c' WHERE key = 'claude-session';");
  expect(findRunsBySession("sess-c").map((m) => m.summary.id)).toEqual(["run6"]);
  db.close();
});
