import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import pino from "pino";
import { Database } from "bun:sqlite";
import { createHerdStore, herdSubject, mintHerdId, isValidJobName, type HerdStore } from "../herd-store.ts";

const log = pino({ level: "silent" });
let dirs: string[] = [];
beforeEach(() => { dirs = []; });
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function store(): HerdStore {
  const dir = mkdtempSync(join(tmpdir(), "rt-herd-store-"));
  dirs.push(dir);
  return createHerdStore({ dbPath: join(dir, "herds.db"), log });
}

function herd(s: HerdStore, id = "demo-20260908-120000") {
  return s.create({ id, repo: "gh:m4ttstack/rt", room: "herd-demo-20260908-120000", workspace: `herd: ${id}`, shepherdSession: "sess-shep", shepherdHandle: "shepherd", herdrSocket: null, hidden: false });
}

describe("herd-store", () => {
  test("mintHerdId stamps name-YYYYMMDD-HHMMSS", () => {
    expect(mintHerdId("demo", new Date(2026, 8, 8, 13, 5, 9))).toBe("demo-20260908-130509");
  });

  test("isValidJobName follows herdr's agent-name grammar", () => {
    expect(isValidJobName("acme-2886")).toBe(true);
    expect(isValidJobName("Cv")).toBe(false);
    expect(isValidJobName("a".repeat(33))).toBe(false);
    expect(isValidJobName("")).toBe(false);
  });

  test("herdSubject composes herd:<id>/<job>", () => {
    expect(herdSubject("demo-1", "job-a")).toBe("herd:demo-1/job-a");
  });

  test("create then get round-trips, status active, wrappedAt null", () => {
    const s = store();
    const row = herd(s);
    expect(row.status).toBe("active");
    expect(s.get(row.id)).toEqual(row);
    expect(s.get("nope")).toBeNull();
  });

  test("create rejects a duplicate id", () => {
    const s = store();
    herd(s);
    expect(() => herd(s)).toThrow(/exists/);
  });

  test("list filters by status; setHerdStatus wrapped stamps wrappedAt", () => {
    const s = store();
    herd(s, "a-1"); herd(s, "b-1");
    s.setHerdStatus("a-1", "wrapped");
    expect(s.list({ status: "active" }).map((h) => h.id)).toEqual(["b-1"]);
    expect(s.get("a-1")!.wrappedAt).not.toBeNull();
  });

  test("setShepherd replaces session and handle", () => {
    const s = store();
    const row = herd(s);
    s.setShepherd(row.id, { session: "sess-2", handle: "shepherd-2" });
    expect(s.get(row.id)).toMatchObject({ shepherdSession: "sess-2", shepherdHandle: "shepherd-2" });
  });

  test("upsertJob inserts then updates the same (herd, name) row", () => {
    const s = store();
    const h = herd(s);
    const j = s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w/job-a", tree: "slot-a", handle: "job-a", status: "spawning" });
    expect(j).toMatchObject({ herd: h.id, name: "job-a", status: "spawning", pane: null, tree: "slot-a", disposable: false });
    const j2 = s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "spawning", pane: "w1:p1", agentSession: "sess-w", disposable: true });
    expect(j2).toMatchObject({ pane: "w1:p1", tree: "slot-a", disposable: true });
    expect(s.jobs(h.id)).toHaveLength(1);
  });

  test("upsertJob onto a new worktree restarts createdAt; the same worktree keeps it", async () => {
    const s = store();
    const h = herd(s);
    const first = s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w/one", handle: "job-a", status: "crashed" });
    await Bun.sleep(5);
    const same = s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w/one", handle: "job-a", status: "active" });
    expect(same.createdAt).toBe(first.createdAt);
    await Bun.sleep(5);
    const respawned = s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w/two", handle: "job-a", status: "spawning" });
    expect(respawned.createdAt).toBeGreaterThan(first.createdAt);
  });

  test("upsertJob rejects a job name outside the grammar", () => {
    const s = store();
    const h = herd(s);
    expect(() => s.upsertJob({ herd: h.id, name: "Bad Name", worktree: "/w", handle: "x", status: "spawning" })).toThrow(/job name/);
  });

  test("jobsByPane and jobBySubject resolve rows", () => {
    const s = store();
    const h = herd(s);
    s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w1:p1" });
    expect(s.jobsByPane("w1:p1").map((j) => j.name)).toEqual(["job-a"]);
    expect(s.jobBySubject(herdSubject(h.id, "job-a"))!.name).toBe("job-a");
    expect(s.jobBySubject("run:abc")).toBeNull();
    expect(s.jobBySubject("herd:nope/job-a")).toBeNull();
  });

  test("setJobStatus updates status, lastGate, lastReport, updatedAt", () => {
    const s = store();
    const h = herd(s);
    s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w", handle: "job-a", status: "active" });
    const before = s.getJob(h.id, "job-a")!.updatedAt;
    s.setJobStatus(h.id, "job-a", "at-gate", { lastGate: "gt-1" });
    const j = s.getJob(h.id, "job-a")!;
    expect(j.status).toBe("at-gate");
    expect(j.lastGate).toBe("gt-1");
    expect(j.updatedAt).toBeGreaterThanOrEqual(before);
    s.setJobStatus(h.id, "job-a", "done", { lastReport: 42 });
    expect(s.getJob(h.id, "job-a")).toMatchObject({ status: "done", lastReport: 42, lastGate: "gt-1" });
  });

  test("upsertJob clears nullable fields on explicit null", () => {
    const s = store();
    const h = herd(s);
    s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: "w1:p1", agentSession: "s" });
    s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w/job-a", handle: "job-a", status: "active", pane: null });
    const j = s.getJob(h.id, "job-a")!;
    expect(j.pane).toBeNull();
    expect(j.agentSession).toBe("s");
  });

  test("upsertJob stores and keeps model, effort and account", () => {
    const s = store();
    const h = herd(s);
    const j = s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w", handle: "job-a", status: "spawning", model: "opus", effort: "high", account: "work" });
    expect(j).toMatchObject({ model: "opus", effort: "high", account: "work" });
    const j2 = s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w", handle: "job-a", status: "active" });
    expect(j2).toMatchObject({ model: "opus", effort: "high", account: "work" });
    const j3 = s.upsertJob({ herd: h.id, name: "job-a", worktree: "/w", handle: "job-a", status: "active", account: null });
    expect(j3).toMatchObject({ model: "opus", effort: "high", account: null });
    const fresh = s.upsertJob({ herd: h.id, name: "job-b", worktree: "/w2", handle: "job-b", status: "spawning" });
    expect(fresh).toMatchObject({ model: null, effort: null, account: null });
  });

  test("opening an old herds.db adds the launch columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-herd-store-"));
    dirs.push(dir);
    const dbPath = join(dir, "herds.db");
    const old = new Database(dbPath, { create: true });
    old.exec(`CREATE TABLE herd_jobs (
      herd TEXT NOT NULL, name TEXT NOT NULL, worktree TEXT NOT NULL, branch TEXT, tree TEXT, pane TEXT,
      agentSession TEXT, agentId TEXT, handle TEXT NOT NULL, status TEXT NOT NULL,
      disposable INTEGER NOT NULL DEFAULT 0, lastGate TEXT, lastReport INTEGER,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY (herd, name)
    );`);
    old.run("INSERT INTO herd_jobs (herd, name, worktree, handle, status, createdAt, updatedAt) VALUES ('h-1', 'job-a', '/w', 'job-a', 'active', 1, 1)");
    old.close();
    const s = createHerdStore({ dbPath, log });
    expect(s.getJob("h-1", "job-a")).toMatchObject({ model: null, effort: null, account: null });
    expect(s.upsertJob({ herd: "h-1", name: "job-a", worktree: "/w", handle: "job-a", status: "active", model: "sonnet" }).model).toBe("sonnet");
  });

  test("tickBudget counts per key", () => {
    const s = store();
    expect(s.tickBudget("h-1", "job-a", "respawns")).toBe(1);
    expect(s.tickBudget("h-1", "job-a", "respawns")).toBe(2);
    expect(s.tickBudget("h-1", "job-a", "respawns")).toBe(3);
    expect(s.tickBudget("h-1", "job-a", "nudges", "gt-1")).toBe(1);
    expect(s.tickBudget("h-1", "job-a", "nudges", "gt-2")).toBe(1);
    expect(s.tickBudget("h-1", "job-a", "nudges", "gt-1")).toBe(2);
    expect(s.tickBudget("h-1", "job-b", "respawns")).toBe(1);
    expect(s.budgetRows("h-1", "job-a")).toEqual(expect.arrayContaining([
      { counter: "respawns", key: "", used: 3 },
      { counter: "nudges", key: "gt-1", used: 2 },
      { counter: "nudges", key: "gt-2", used: 1 },
    ]));
    expect(s.budgetRows("h-1", "job-a")).toHaveLength(3);
  });

  test("markBudgetOnce inserts a report id once", () => {
    const s = store();
    expect(s.markBudgetOnce("h-1", "job-a", "unmergedReports", "41")).toBe(true);
    expect(s.markBudgetOnce("h-1", "job-a", "unmergedReports", "41")).toBe(false);
    expect(s.markBudgetOnce("h-1", "job-a", "unmergedReports", "57")).toBe(true);
    expect(s.budgetRows("h-1", "job-a")).toEqual(expect.arrayContaining([
      { counter: "unmergedReports", key: "41", used: 1 },
      { counter: "unmergedReports", key: "57", used: 1 },
    ]));
    expect(s.budgetRows("h-1", "job-a")).toHaveLength(2);
  });

  test("watchdog rows round-trip and clear", () => {
    const s = store();
    expect(s.watchdogLoad()).toEqual({ ladders: [], marks: [] });
    s.watchdogSaveLadder({ key: "h-1/job-a", strikes: 1, lastPokeAt: null, since: 100, parked: false });
    s.watchdogSaveLadder({ key: "h-1/job-a", strikes: 3, lastPokeAt: 200, since: 100, parked: true });
    s.watchdogSaveLadder({ key: "h-1/@shepherd", strikes: 1, lastPokeAt: 150, since: 120, parked: false });
    s.watchdogMark("action", "h-1/job-a", 200);
    s.watchdogMark("action", "h-1/job-a", 300);
    s.watchdogMark("notified", "h-1", 250);
    const loaded = s.watchdogLoad();
    expect(loaded.ladders).toEqual(expect.arrayContaining([
      { key: "h-1/job-a", strikes: 3, lastPokeAt: 200, since: 100, parked: true },
      { key: "h-1/@shepherd", strikes: 1, lastPokeAt: 150, since: 120, parked: false },
    ]));
    expect(loaded.ladders).toHaveLength(2);
    expect(loaded.marks).toEqual(expect.arrayContaining([
      { kind: "action", key: "h-1/job-a", at: 300 },
      { kind: "notified", key: "h-1", at: 250 },
    ]));
    expect(loaded.marks).toHaveLength(2);
    s.watchdogDeleteLadder("h-1/@shepherd");
    expect(s.watchdogLoad().ladders.map((l) => l.key)).toEqual(["h-1/job-a"]);
    s.watchdogClear();
    expect(s.watchdogLoad()).toEqual({ ladders: [], marks: [] });
  });
});
