import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import pino from "pino";
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

  test("an attempt records its mode; one from a herds.db that predates modes reads as a herdr pane", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-herd-store-"));
    dirs.push(dir);
    const path = join(dir, "herds.db");
    const old = new Database(path, { create: true });
    old.exec("CREATE TABLE herd_job_attempts (id TEXT PRIMARY KEY, herd TEXT NOT NULL, job TEXT NOT NULL, selection TEXT NOT NULL, bindingKey TEXT, generation INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, replaces TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, activatedAt INTEGER, endedAt INTEGER)");
    old.run("INSERT INTO herd_job_attempts (id, herd, job, selection, state, createdAt, updatedAt) VALUES ('att-old', 'h', 'job-a', ?, 'active', 1, 1)", [JSON.stringify({ harness: "claude", options: {} })]);
    old.close();

    const s = createHerdStore({ dbPath: path, log });
    expect(s.getAttempt("att-old")?.mode).toBe("herdr");
    s.reserveAttempt({ id: "att-new", herd: "h", job: "job-b", selection: { harness: "codex", options: {} }, mode: "headless" });
    s.close_();
    const reopened = createHerdStore({ dbPath: path, log });
    expect(reopened.getAttempt("att-new")?.mode).toBe("headless");
    reopened.close_();
  });

  test("an attempt activates only over the attempt it was reserved to replace", () => {
    const s = store();
    const selection = { harness: "claude", options: { model: "opus" } };
    s.reserveAttempt({ id: "att-1", herd: "h", job: "job-a", selection });
    expect(s.activateAttempt("att-1", "sk-1", 1)).toMatchObject({ ok: true, data: { state: "active", bindingKey: "sk-1", generation: 1 } });
    s.reserveAttempt({ id: "att-2", herd: "h", job: "job-a", selection });
    s.reserveAttempt({ id: "att-3", herd: "h", job: "job-a", selection, replaces: "att-1" });
    expect(s.activateAttempt("att-2", "sk-2", 1)).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(s.activateAttempt("att-3", "sk-3", 1).ok).toBe(true);
    expect(s.activateAttempt("att-1", "sk-1", 2)).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(s.attempts("h", "job-a").map((a) => a.state)).toEqual(["replaced", "reserved", "active"]);
    expect(s.activeAttempt("h", "job-a")?.id).toBe("att-3");
  });

  test("an active attempt refreshes only for its own binding at the same or a later generation", () => {
    const s = store();
    s.reserveAttempt({ id: "att-1", herd: "h", job: "job-a", selection: { harness: "claude", options: {} } });
    s.activateAttempt("att-1", "sk-1", 2);
    expect(s.activateAttempt("att-1", "sk-1", 3)).toMatchObject({ ok: true, data: { generation: 3 } });
    expect(s.activateAttempt("att-1", "sk-1", 2).ok).toBe(false);
    expect(s.activateAttempt("att-1", "sk-other", 4).ok).toBe(false);
    expect(s.endAttempt("att-1", ["reserved"])).toBe(false);
    expect(s.getAttempt("att-1")?.state).toBe("active");
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
});
