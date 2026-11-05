import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { seedRun } from "../../runs/__tests__/fixtures.ts";
import { openUsageDb } from "../store.ts";
import {
  classifyAgentSessions,
  linkAgents,
  linkedSessionIds,
  snapshotRuns,
  type AgentLink,
} from "../sources.ts";
import type { TranscriptFile } from "../transcripts.ts";

const M = "machine-a";
const REPO = "remote:github.com%2Facme%2Fwidgets";
let dir: string;
let runs: string;
let db: ReturnType<typeof openUsageDb>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-sources-"));
  runs = join(dir, "runs");
  mkdirSync(runs);
  db = openUsageDb(join(dir, "usage.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const field = (key: string, value: string) => ({ key, value });
const agent = (o: Partial<AgentLink>): AgentLink => ({
  id: "ag-1",
  sessionId: "s-1",
  subject: null,
  label: null,
  caller: null,
  ...o,
});

test("copies a run and its stages", () => {
  seedRun(runs, REPO, "run-1", 1000, 1, {
    status: "done",
    stages: [
      { name: "plan", status: "done", startedAt: 1000, endedAt: 2000 },
      { name: "build", status: "running", startedAt: 2000 },
    ],
    fields: [field("mr", "https://github.com/acme/widgets/pull/7")],
  });
  expect(snapshotRuns(db, runs, M)).toEqual({ runs: 1, skipped: 0, unresolvedMr: 0 });
  expect(db.query("SELECT * FROM usage_runs").all()).toEqual([
    {
      machine_id: M,
      run_id: "run-1",
      repo: REPO,
      pipeline: "default",
      work_type: "feature",
      spawned_by: null,
      status: "done",
      started_at: 1000,
      ended_at: null,
      mr_key: `${REPO}!7`,
      mr_url: "https://github.com/acme/widgets/pull/7",
      ticket: "ACME-1",
      branch: "goodwin/mat-1",
    },
  ]);
  expect(
    db.query("SELECT name, attempt, status, started_at, ended_at FROM usage_stages ORDER BY name").all(),
  ).toEqual([
    { name: "build", attempt: 1, status: "running", started_at: 2000, ended_at: null },
    { name: "plan", attempt: 1, status: "done", started_at: 1000, ended_at: 2000 },
  ]);
});

test("reads the mr field directly", () => {
  seedRun(runs, REPO, "run-1", 1000, 1, { fields: [field("mr", "!405")] });
  seedRun(runs, REPO, "run-2", 1000, 1, { fields: [field("mr", "-")] });
  seedRun(runs, REPO, "run-3", 1000, 1, { fields: [field("mr", "not a link")] });
  const result = snapshotRuns(db, runs, M);
  expect(result.unresolvedMr).toBe(1);
  expect(db.query("SELECT run_id, mr_key, mr_url FROM usage_runs ORDER BY run_id").all()).toEqual([
    { run_id: "run-1", mr_key: `${REPO}!405`, mr_url: null },
    { run_id: "run-2", mr_key: null, mr_url: null },
    { run_id: "run-3", mr_key: null, mr_url: null },
  ]);
});

test("links claude-sessions and falls back to claude-session", () => {
  seedRun(runs, REPO, "run-1", 1000, 1, {
    fields: [field("claude-sessions", '["s-a","s-b"]'), field("claude-session", "s-b")],
  });
  seedRun(runs, REPO, "run-2", 1000, 1, { fields: [field("claude-session", "s-c")] });
  seedRun(runs, REPO, "run-3", 1000, 1, {
    fields: [field("claude-sessions", "{not json"), field("claude-session", "s-d")],
  });
  seedRun(runs, REPO, "run-4", 1000, 1, {
    fields: [field("claude-sessions", '{"a":1}'), field("claude-session", "s-e")],
  });
  snapshotRuns(db, runs, M);
  expect(
    db.query("SELECT session_id, source, ref FROM usage_sessions ORDER BY session_id").all(),
  ).toEqual([
    { session_id: "s-a", source: "run", ref: "run-1" },
    { session_id: "s-b", source: "run", ref: "run-1" },
    { session_id: "s-c", source: "run", ref: "run-2" },
    { session_id: "s-d", source: "run", ref: "run-3" },
    { session_id: "s-e", source: "run", ref: "run-4" },
  ]);
});

test("skips test runs", () => {
  seedRun(runs, REPO, "run-1", 1000, 1, {
    fields: [field("test", "1"), field("claude-session", "s-t")],
  });
  expect(snapshotRuns(db, runs, M)).toEqual({ runs: 0, skipped: 0, unresolvedMr: 0 });
  for (const t of ["usage_runs", "usage_stages", "usage_sessions"]) {
    expect(db.query(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
  }
});

test("a corrupt run DB is skipped", () => {
  seedRun(runs, REPO, "run-good", 1000, 1);
  mkdirSync(join(runs, REPO, "run-bad"), { recursive: true });
  writeFileSync(join(runs, REPO, "run-bad", "state.db"), "this is not sqlite".repeat(100));
  expect(snapshotRuns(db, runs, M)).toEqual({ runs: 1, skipped: 1, unresolvedMr: 0 });
  expect(db.query("SELECT run_id FROM usage_runs").all()).toEqual([{ run_id: "run-good" }]);
});

test("an old-schema run DB still snapshots", () => {
  seedRun(runs, REPO, "run-old", 1000, 1);
  expect(snapshotRuns(db, runs, M).runs).toBe(1);
  expect(db.query("SELECT run_id FROM usage_runs").all()).toEqual([{ run_id: "run-old" }]);
});

test("a missing runs root snapshots nothing", () => {
  expect(snapshotRuns(db, join(dir, "nope"), M)).toEqual({ runs: 0, skipped: 0, unresolvedMr: 0 });
});

test("a pruned run keeps its snapshot", () => {
  seedRun(runs, REPO, "run-1", 1000, 1, { fields: [field("claude-session", "s-1")] });
  snapshotRuns(db, runs, M);
  const dump = () => ({
    runs: db.query("SELECT * FROM usage_runs").all(),
    stages: db.query("SELECT * FROM usage_stages").all(),
    sessions: db.query("SELECT * FROM usage_sessions").all(),
  });
  const before = dump();
  rmSync(join(runs, REPO, "run-1"), { recursive: true });
  expect(snapshotRuns(db, runs, M).runs).toBe(0);
  expect(dump()).toEqual(before);
});

test("a re-snapshot refreshes a live run", () => {
  seedRun(runs, REPO, "run-1", 1000, 1, { status: "running" });
  snapshotRuns(db, runs, M);
  rmSync(join(runs, REPO, "run-1"), { recursive: true });
  seedRun(runs, REPO, "run-1", 1000, 1, { status: "done" });
  snapshotRuns(db, runs, M);
  expect(db.query("SELECT status FROM usage_runs").all()).toEqual([{ status: "done" }]);
});

test("a mr: agent links session to MR", () => {
  linkAgents(
    db,
    [agent({ subject: "mr:https://github.com/acme/widgets/pull/7", label: "review" })],
    M,
  );
  expect(db.query("SELECT * FROM usage_sessions").all()).toEqual([
    {
      machine_id: M,
      session_id: "s-1",
      source: "agent",
      ref: "ag-1",
      agent_mr_key: `${REPO}!7`,
      agent_kind: "other",
    },
  ]);
});

test("a run: agent adds a session to that run", () => {
  linkAgents(db, [agent({ subject: "run:run-9" })], M);
  expect(db.query("SELECT * FROM usage_sessions").all()).toEqual([
    {
      machine_id: M,
      session_id: "s-1",
      source: "run",
      ref: "run-9",
      agent_mr_key: null,
      agent_kind: null,
    },
  ]);
});

test("a doctor agent is marked doctor", () => {
  linkAgents(
    db,
    [agent({ subject: "mr:https://github.com/acme/widgets/pull/7", label: "MR doctor" })],
    M,
  );
  expect(db.query("SELECT agent_kind FROM usage_sessions").all()).toEqual([
    { agent_kind: "doctor" },
  ]);
});

test("agents without a session or a known subject write no link", () => {
  linkAgents(
    db,
    [
      agent({ sessionId: "", subject: "mr:https://github.com/acme/widgets/pull/7" }),
      agent({ id: "ag-2", subject: "agent:ag-2" }),
      agent({ id: "ag-3", subject: null }),
    ],
    M,
  );
  expect(db.query("SELECT COUNT(*) AS n FROM usage_sessions").get()).toEqual({ n: 0 });
});

test("linkedSessionIds lists this machine's sessions only", () => {
  linkAgents(db, [agent({ subject: "run:run-9" })], M);
  linkAgents(db, [agent({ sessionId: "s-other", subject: "run:run-9" })], "machine-b");
  expect(linkedSessionIds(db, M)).toEqual(new Set(["s-1"]));
});

const MR = "mr:https://github.com/acme/widgets/pull/7";
const transcript = (name: string, text: string, o: Partial<TranscriptFile> = {}): TranscriptFile => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return {
    path,
    sessionId: "s-1",
    configDir: dir,
    subagentId: null,
    subagentType: null,
    subagentModel: null,
    ...o,
  };
};
const kind = () => db.query("SELECT agent_kind FROM usage_sessions").all();

test("a board doctor transcript marks the session doctor", () => {
  linkAgents(db, [agent({ subject: MR })], M);
  const file = transcript(
    "doctor.jsonl",
    '{"type":"user","message":{"content":"<command-name>/board:doctor</command-name>"}}\n',
  );
  expect(classifyAgentSessions(db, [file], M)).toEqual({ doctors: 1 });
  expect(kind()).toEqual([{ agent_kind: "doctor" }]);
});

test("a review transcript stays other", () => {
  linkAgents(db, [agent({ subject: MR })], M);
  const file = transcript(
    "review.jsonl",
    '{"type":"user","message":{"content":"<command-name>/board:review</command-name>"}}\n',
  );
  expect(classifyAgentSessions(db, [file], M)).toEqual({ doctors: 0 });
  expect(kind()).toEqual([{ agent_kind: "other" }]);
});

test("a marker past the first 64KB is ignored", () => {
  linkAgents(db, [agent({ subject: MR })], M);
  const file = transcript("late.jsonl", `${"x".repeat(64 * 1024)}<command-name>/board:doctor<`);
  expect(classifyAgentSessions(db, [file], M)).toEqual({ doctors: 0 });
  expect(kind()).toEqual([{ agent_kind: "other" }]);
});

test("a subagent transcript is not read for the marker", () => {
  linkAgents(db, [agent({ subject: MR })], M);
  const file = transcript("sub.jsonl", "<command-name>/board:doctor<", { subagentId: "a1" });
  expect(classifyAgentSessions(db, [file], M)).toEqual({ doctors: 0 });
});

test("relinking keeps doctor", () => {
  linkAgents(db, [agent({ subject: MR })], M);
  classifyAgentSessions(db, [transcript("d.jsonl", "<command-name>/board:doctor<")], M);
  linkAgents(db, [agent({ subject: MR })], M);
  expect(kind()).toEqual([{ agent_kind: "doctor" }]);
});

test("an unreadable or missing transcript leaves the row alone", () => {
  linkAgents(db, [agent({ subject: MR })], M);
  const gone = { ...transcript("g.jsonl", "x"), path: join(dir, "missing.jsonl") };
  const unreadable = { ...gone, path: dir };
  expect(classifyAgentSessions(db, [gone], M)).toEqual({ doctors: 0 });
  expect(classifyAgentSessions(db, [unreadable], M)).toEqual({ doctors: 0 });
  expect(classifyAgentSessions(db, [], M)).toEqual({ doctors: 0 });
  expect(kind()).toEqual([{ agent_kind: "other" }]);
});
