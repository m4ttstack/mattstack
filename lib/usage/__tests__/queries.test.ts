import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { usageMr, usageMrs, usageStatus, usageTrends } from "../queries.ts";
import { openUsageDb } from "../store.ts";

const M = "machine-a";
const REPO = "remote:github.com%2Facme%2Fwidgets";
const MR_A = `${REPO}!1`;
const MR_B = `${REPO}!2`;
const MR_C = `${REPO}!3`;
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 4, 12).getTime();
const OPUS = "claude-opus-5";
const MILLION = 1_000_000;

let dir: string;
let dbPath: string;
let db: ReturnType<typeof openUsageDb>;
let seq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-queries-"));
  dbPath = join(dir, "usage.db");
  db = openUsageDb(dbPath);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface RunSeed {
  workType?: string;
  startedAt?: number;
  mrKey?: string | null;
  url?: string | null;
  ticket?: string | null;
  branch?: string | null;
  repo?: string | null;
  pipeline?: string | null;
  machine?: string;
}

function run(id: string, o: RunSeed = {}): void {
  db.query(
    `INSERT INTO usage_runs (machine_id, run_id, repo, pipeline, work_type, status, started_at, mr_key, mr_url, ticket, branch)
     VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?)`,
  ).run(
    o.machine ?? M,
    id,
    o.repo ?? REPO,
    o.pipeline ?? "work",
    o.workType ?? "feature",
    o.startedAt ?? NOW - DAY,
    o.mrKey ?? null,
    o.url ?? null,
    o.ticket ?? null,
    o.branch ?? null,
  );
}

function stage(runId: string, name: string, attempt: number, startedAt: number): void {
  db.query(
    `INSERT INTO usage_stages (machine_id, run_id, name, attempt, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'done', ?, ?)`,
  ).run(M, runId, name, attempt, startedAt, startedAt + 1000);
}

function agentLink(session: string, ref: string, kind: string | null, mrKey: string | null): void {
  db.query(
    `INSERT INTO usage_sessions (machine_id, session_id, source, ref, agent_mr_key, agent_kind)
     VALUES (?, ?, 'agent', ?, ?, ?)`,
  ).run(M, session, ref, mrKey, kind);
}

function runLink(session: string, ref: string): void {
  db.query(
    "INSERT INTO usage_sessions (machine_id, session_id, source, ref) VALUES (?, ?, 'run', ?)",
  ).run(M, session, ref);
}

interface MessageSeed {
  session?: string;
  ts?: number;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  speed?: string | null;
  subagent?: string | null;
  runId?: string | null;
  stage?: string | null;
  attempt?: number | null;
  mrKey?: string | null;
  attribution?: string;
  machine?: string;
}

function message(o: MessageSeed): void {
  db.query(
    `INSERT INTO usage_messages (machine_id, message_id, session_id, ts, model, subagent_id, input, output,
       cache_read, cache_write_5m, cache_write_1h, speed, run_id, stage, attempt, mr_key, attribution)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    o.machine ?? M,
    `msg-${++seq}`,
    o.session ?? "s-1",
    o.ts ?? NOW - DAY,
    o.model ?? OPUS,
    o.subagent ?? null,
    o.input ?? 0,
    o.output ?? 0,
    o.cacheRead ?? 0,
    o.cacheWrite5m ?? 0,
    o.cacheWrite1h ?? 0,
    o.speed ?? null,
    o.runId ?? null,
    o.stage ?? null,
    o.attempt ?? null,
    o.mrKey ?? null,
    o.attribution ?? "run",
  );
}

test("a missing database gives empty results", () => {
  const missing = join(dir, "never-swept.db");
  const mrs = usageMrs(missing, { now: NOW });
  expect(mrs.mrs).toEqual([]);
  expect(mrs.summary.mrCount).toBe(0);
  expect(mrs.summary.medianCost).toBe(0);
  expect(mrs.summary.totals).toEqual({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    unpricedTokens: 0,
  });
  expect(usageMr(missing, MR_A)).toBeNull();
  const trends = usageTrends(missing, { days: 30, now: NOW });
  expect(trends.weeks).toEqual([]);
  expect(trends.byPipeline).toEqual([]);
  expect(trends.byModel).toEqual([]);
  const status = usageStatus(missing);
  expect(status.lastSweepAt).toBeNull();
  expect(status.lastSweepMs).toBeNull();
  expect(status.messages).toBe(0);
  expect(status.skippedRate).toBe(0);
});

test("a created store with no sweep gives empty results", () => {
  expect(usageMrs(dbPath, { now: NOW }).mrs).toEqual([]);
  expect(usageMr(dbPath, MR_A)).toBeNull();
  expect(usageTrends(dbPath, { days: 30, now: NOW }).weeks).toEqual([]);
  expect(usageStatus(dbPath).lastSweepAt).toBeNull();
});

test("a file with no tables gives empty results", () => {
  const blank = join(dir, "blank.db");
  writeFileSync(blank, "");
  expect(usageMrs(blank, { now: NOW }).mrs).toEqual([]);
  expect(usageMr(blank, MR_A)).toBeNull();
  expect(usageTrends(blank, { days: 30, now: NOW }).weeks).toEqual([]);
  expect(usageStatus(blank).lastSweepAt).toBeNull();
});

function seedMixedMr(): void {
  run("w", { workType: "feature", mrKey: MR_A, startedAt: NOW - 5 * DAY });
  run("r", { workType: "receive-review", mrKey: MR_A, startedAt: NOW - 4 * DAY });
  run("v", { workType: "review", mrKey: MR_A, startedAt: NOW - 3 * DAY });
  agentLink("s-doc", "agent-1", "doctor", MR_A);
  message({ runId: "w", mrKey: MR_A, input: MILLION, ts: NOW - 5 * DAY });
  message({ runId: "r", mrKey: MR_A, input: 2 * MILLION, ts: NOW - 4 * DAY });
  message({ runId: "v", mrKey: MR_A, input: 3 * MILLION, ts: NOW - 3 * DAY });
  message({ session: "s-doc", mrKey: MR_A, input: 4 * MILLION, ts: NOW - 2 * DAY, attribution: "session" });
}

test("an MR total adds work, respond, review and doctor", () => {
  seedMixedMr();
  const { mrs } = usageMrs(dbPath, { now: NOW });
  expect(mrs).toHaveLength(1);
  expect(mrs[0]!.mrKey).toBe(MR_A);
  expect(mrs[0]!.totals.input).toBe(10 * MILLION);
  expect(mrs[0]!.totals.cost).toBeCloseTo(50, 6);
  expect(mrs[0]!.firstActivity).toBe(NOW - 5 * DAY);
  expect(mrs[0]!.lastActivity).toBe(NOW - 2 * DAY);
  expect(mrs[0]!.runCount).toBe(3);
  expect(mrs[0]!.roundCount).toBe(1);
});

test("cost is split by kind", () => {
  seedMixedMr();
  const { costByKind } = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect(costByKind.work).toBeCloseTo(5, 6);
  expect(costByKind.respond).toBeCloseTo(10, 6);
  expect(costByKind.review).toBeCloseTo(15, 6);
  expect(costByKind.doctor).toBeCloseTo(20, 6);
  expect(costByKind.other).toBe(0);
});

test("cache writes are reported together and priced apart", () => {
  run("w", { mrKey: MR_A });
  message({ runId: "w", mrKey: MR_A, cacheWrite5m: MILLION, cacheWrite1h: 2 * MILLION });
  const { totals } = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect(totals.cacheWrite).toBe(3 * MILLION);
  expect(totals.cost).toBeCloseTo(5 * 1.25 + 5 * 2 * 2, 6);
});

test("fast messages are priced apart from standard ones", () => {
  run("w", { mrKey: MR_A });
  message({ runId: "w", mrKey: MR_A, input: MILLION, speed: "fast" });
  message({ runId: "w", mrKey: MR_A, input: MILLION });
  expect(usageMrs(dbPath, { now: NOW }).mrs[0]!.totals.cost).toBeCloseTo(15, 6);
});

test("Haiku 5.5 is priced one message at a time, dated or not", () => {
  run("w", { mrKey: MR_A });
  for (const model of ["claude-haiku-5-5", "claude-haiku-5-5-20261001"]) {
    message({ runId: "w", mrKey: MR_A, model, input: 60_000 });
    message({ runId: "w", mrKey: MR_A, model, input: 60_000 });
  }
  const { totals } = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect(totals.cost).toBeCloseTo((240_000 * 0.1) / MILLION, 9);
});

test("rounds number respond runs by start time", () => {
  run("later", { workType: "receive-review", mrKey: MR_A, startedAt: NOW - DAY });
  run("earlier", { workType: "receive-review", mrKey: MR_A, startedAt: NOW - 2 * DAY });
  run("work", { workType: "feature", mrKey: MR_A, startedAt: NOW - 3 * DAY });
  message({ runId: "later", mrKey: MR_A, input: 1, ts: NOW - DAY });
  message({ runId: "earlier", mrKey: MR_A, input: 1, ts: NOW - 2 * DAY });
  message({ runId: "work", mrKey: MR_A, input: 1, ts: NOW - 3 * DAY });
  const mr = usageMr(dbPath, MR_A)!;
  const rounds = Object.fromEntries(mr.runs.map((r) => [r.runId, r.round]));
  expect(rounds).toEqual({ work: null, earlier: 1, later: 2 });
  expect(usageMrs(dbPath, { now: NOW }).mrs[0]!.roundCount).toBe(2);
});

test("the range filters on last activity", () => {
  run("old", { mrKey: MR_A });
  run("spans", { mrKey: MR_B });
  message({ runId: "old", mrKey: MR_A, input: 1, ts: NOW - 10 * DAY });
  message({ runId: "spans", mrKey: MR_B, input: 5, ts: NOW - 10 * DAY });
  message({ runId: "spans", mrKey: MR_B, input: 7, ts: NOW - DAY });
  const { mrs, summary } = usageMrs(dbPath, { days: 7, now: NOW });
  expect(mrs.map((m) => m.mrKey)).toEqual([MR_B]);
  expect(mrs[0]!.totals.input).toBe(12);
  expect(summary.mrCount).toBe(1);
  expect(summary.totals.input).toBe(12);
});

test("the range keeps an MR active exactly at the cutoff", () => {
  run("edge", { mrKey: MR_A });
  message({ runId: "edge", mrKey: MR_A, input: 1, ts: NOW - 7 * DAY });
  expect(usageMrs(dbPath, { days: 7, now: NOW }).mrs).toHaveLength(1);
});

test("MRs sort by last activity, newest first", () => {
  run("a", { mrKey: MR_A });
  run("b", { mrKey: MR_B });
  message({ runId: "a", mrKey: MR_A, input: 1, ts: NOW - 3 * DAY });
  message({ runId: "b", mrKey: MR_B, input: 1, ts: NOW - DAY });
  expect(usageMrs(dbPath, { now: NOW }).mrs.map((m) => m.mrKey)).toEqual([MR_B, MR_A]);
});

function seedCosts(costs: [string, number][]): void {
  costs.forEach(([key, dollars], i) => {
    run(`run-${i}`, { mrKey: key });
    message({ runId: `run-${i}`, mrKey: key, input: (dollars / 5) * MILLION });
  });
}

test("the summary has a median MR", () => {
  seedCosts([
    [MR_A, 1],
    [MR_B, 2],
    [MR_C, 9],
  ]);
  expect(usageMrs(dbPath, { now: NOW }).summary.medianCost).toBeCloseTo(2, 6);
});

test("an even count of MRs averages the middle two", () => {
  seedCosts([
    [MR_A, 1],
    [MR_B, 2],
    [MR_C, 4],
    [`${REPO}!4`, 9],
  ]);
  expect(usageMrs(dbPath, { now: NOW }).summary.medianCost).toBeCloseTo(3, 6);
});

test("ticket, branch and url come from the latest run", () => {
  run("first", { mrKey: MR_A, startedAt: NOW - 3 * DAY, ticket: "WEB-1", branch: "old", url: "u1" });
  run("last", { mrKey: MR_A, startedAt: NOW - DAY, ticket: "WEB-2", branch: "new", url: "u2" });
  message({ runId: "last", mrKey: MR_A, input: 1, ts: NOW - 5 * DAY });
  message({ runId: "first", mrKey: MR_A, input: 1, ts: NOW - DAY });
  const row = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect([row.ticket, row.branch, row.url]).toEqual(["WEB-2", "new", "u2"]);
  const mr = usageMr(dbPath, MR_A)!;
  expect([mr.ticket, mr.branch, mr.url]).toEqual(["WEB-2", "new", "u2"]);
});

test("an MR with no run has null ticket, branch and url", () => {
  agentLink("s-doc", "agent-1", "doctor", MR_A);
  message({ session: "s-doc", mrKey: MR_A, input: 1, attribution: "session" });
  const row = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect([row.ticket, row.branch, row.url]).toEqual([null, null, null]);
  expect(row.runCount).toBe(0);
});

test("the repo filter is an exact identity match", () => {
  const underscored = "remote:github.com%2Facme%2Fmy_app";
  const dashed = "remote:github.com%2Facme%2Fmy-app";
  run("a", { mrKey: `${underscored}!1` });
  run("b", { mrKey: `${dashed}!1` });
  run("c", { mrKey: `${underscored}-two!1` });
  message({ runId: "a", mrKey: `${underscored}!1`, input: 1 });
  message({ runId: "b", mrKey: `${dashed}!1`, input: 1 });
  message({ runId: "c", mrKey: `${underscored}-two!1`, input: 1 });
  const { mrs } = usageMrs(dbPath, { repo: underscored, now: NOW });
  expect(mrs.map((m) => m.mrKey)).toEqual([`${underscored}!1`]);
});

test("several agent links on a session count its messages once", () => {
  agentLink("s-doc", "agent-1", "other", MR_A);
  agentLink("s-doc", "agent-2", "doctor", MR_A);
  agentLink("s-doc", "agent-3", "other", MR_B);
  message({ session: "s-doc", mrKey: MR_A, input: MILLION, attribution: "session" });
  const row = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect(row.totals.input).toBe(MILLION);
  expect(row.costByKind.doctor).toBeCloseTo(5, 6);
  expect(row.costByKind.other).toBe(0);
  const mr = usageMr(dbPath, MR_A)!;
  expect(mr.totals.input).toBe(MILLION);
  expect(mr.runs).toHaveLength(1);
  expect(mr.runs[0]!.kind).toBe("doctor");
});

test("a session with run and agent links counts its messages once", () => {
  run("w", { mrKey: MR_A });
  runLink("s-1", "w");
  agentLink("s-1", "agent-1", "doctor", MR_A);
  message({ runId: "w", mrKey: MR_A, input: MILLION });
  const row = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect(row.totals.input).toBe(MILLION);
  expect(row.costByKind.work).toBeCloseTo(5, 6);
  expect(row.costByKind.doctor).toBe(0);
});

test("the same run id on two machines stays apart", () => {
  run("shared", { workType: "feature", mrKey: MR_A, startedAt: NOW - 3 * DAY });
  run("shared", { workType: "review", mrKey: MR_B, machine: "machine-b", startedAt: NOW - DAY });
  message({ runId: "shared", mrKey: MR_A, input: MILLION });
  message({ runId: "shared", mrKey: MR_B, input: MILLION, machine: "machine-b" });
  const rows = usageMrs(dbPath, { now: NOW }).mrs;
  const a = rows.find((m) => m.mrKey === MR_A)!;
  const b = rows.find((m) => m.mrKey === MR_B)!;
  expect(a.totals.input).toBe(MILLION);
  expect(a.costByKind.work).toBeCloseTo(5, 6);
  expect(b.totals.input).toBe(MILLION);
  expect(b.costByKind.review).toBeCloseTo(5, 6);
  expect(usageMr(dbPath, MR_A)!.runs).toHaveLength(1);
});

test("a run with no MR still holds messages that took one from an agent link", () => {
  run("respond", { workType: "receive-review", mrKey: null });
  agentLink("s-1", "agent-1", "other", MR_A);
  message({ runId: "respond", mrKey: MR_A, input: MILLION, stage: "fix", attempt: 1 });
  const row = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect(row.costByKind.respond).toBeCloseTo(5, 6);
  expect(row.runCount).toBe(1);
  expect(row.roundCount).toBe(1);
  const mr = usageMr(dbPath, MR_A)!;
  expect(mr.runs).toHaveLength(1);
  expect(mr.runs[0]!.runId).toBe("respond");
  expect(mr.runs[0]!.kind).toBe("respond");
  expect(mr.runs[0]!.round).toBe(1);
});

test("usageMr lists runs in time order with their stages", () => {
  run("second", { workType: "receive-review", mrKey: MR_A, startedAt: NOW - DAY });
  run("first", { workType: "feature", mrKey: MR_A, startedAt: NOW - 2 * DAY });
  stage("first", "build", 1, NOW - 2 * DAY);
  stage("first", "build", 2, NOW - 2 * DAY + 5000);
  message({ runId: "first", mrKey: MR_A, input: 10, stage: "build", attempt: 1, attribution: "stage", ts: NOW - 2 * DAY });
  message({ runId: "first", mrKey: MR_A, input: 20, stage: "build", attempt: 2, attribution: "stage", ts: NOW - 2 * DAY + 6000 });
  message({ runId: "first", mrKey: MR_A, input: 4, attribution: "run", ts: NOW - 2 * DAY + 100 });
  message({ runId: "first", mrKey: MR_A, input: 3, attribution: "session", ts: NOW - 2 * DAY + 200 });
  message({ runId: "second", mrKey: MR_A, input: 1, ts: NOW - DAY });
  const mr = usageMr(dbPath, MR_A)!;
  expect(mr.mrKey).toBe(MR_A);
  expect(mr.totals.input).toBe(38);
  expect(mr.runs.map((r) => r.runId)).toEqual(["first", "second"]);
  const [first] = mr.runs;
  expect(first!.kind).toBe("work");
  expect(first!.totals.input).toBe(37);
  expect(first!.stages.map((s) => [s.name, s.attempt, s.totals.input])).toEqual([
    ["build", 1, 10],
    ["build", 2, 20],
    [null, null, 7],
  ]);
  expect(first!.stages[0]!.status).toBe("done");
});

test("by-model and main-vs-subagent splits add up to the total", () => {
  run("w", { mrKey: MR_A });
  message({ runId: "w", mrKey: MR_A, input: 100, model: OPUS });
  message({ runId: "w", mrKey: MR_A, input: 200, model: OPUS, subagent: "sub-1" });
  message({ runId: "w", mrKey: MR_A, input: 400, model: "claude-sonnet-5" });
  const mr = usageMr(dbPath, MR_A)!;
  const entry = mr.runs[0]!;
  for (const scope of [mr, entry]) {
    expect(scope.totals.input).toBe(700);
    expect(scope.byModel.reduce((sum, m) => sum + m.totals.input, 0)).toBe(700);
    expect(scope.main.input + scope.subagent.input).toBe(700);
    expect(scope.main.input).toBe(500);
    expect(scope.subagent.input).toBe(200);
    expect(scope.byModel.reduce((sum, m) => sum + m.totals.cost, 0)).toBeCloseTo(scope.totals.cost, 9);
    expect(scope.main.cost + scope.subagent.cost).toBeCloseTo(scope.totals.cost, 9);
  }
});

test("an agent-only doctor session appears as a run-less entry of kind doctor", () => {
  run("w", { mrKey: MR_A, startedAt: NOW - 3 * DAY });
  message({ runId: "w", mrKey: MR_A, input: 1, ts: NOW - 3 * DAY });
  agentLink("s-doc", "agent-1", "doctor", MR_A);
  agentLink("s-other", "agent-2", "other", MR_A);
  message({ session: "s-doc", mrKey: MR_A, input: 2, ts: NOW - 4 * DAY, attribution: "session" });
  message({ session: "s-doc", mrKey: MR_A, input: 3, ts: NOW - DAY, attribution: "session" });
  message({ session: "s-other", mrKey: MR_A, input: 5, ts: NOW - 2 * DAY, attribution: "session" });
  const { runs } = usageMr(dbPath, MR_A)!;
  expect(runs.map((r) => [r.runId, r.sessionId, r.kind, r.totals.input])).toEqual([
    [null, "s-doc", "doctor", 5],
    ["w", null, "work", 1],
    [null, "s-other", "other", 5],
  ]);
});

test("usageMr returns null for an unknown key", () => {
  run("w", { mrKey: MR_A });
  message({ runId: "w", mrKey: MR_A, input: 1 });
  expect(usageMr(dbPath, MR_B)).toBeNull();
});

test("an unknown model raises unpricedTokens and cost covers the rest", () => {
  run("w", { mrKey: MR_A });
  message({ runId: "w", mrKey: MR_A, input: MILLION });
  message({
    runId: "w",
    mrKey: MR_A,
    model: "claude-future-9",
    input: 1,
    output: 2,
    cacheRead: 4,
    cacheWrite5m: 8,
    cacheWrite1h: 16,
  });
  const { totals } = usageMrs(dbPath, { now: NOW }).mrs[0]!;
  expect(totals.unpricedTokens).toBe(31);
  expect(totals.cost).toBeCloseTo(5, 6);
  expect(totals.input).toBe(MILLION + 1);
  expect(totals.output).toBe(2);
  expect(totals.cacheRead).toBe(4);
  expect(totals.cacheWrite).toBe(24);
});

test("kinds are derived at read time", () => {
  run("w", { workType: "feature", mrKey: MR_A });
  message({ runId: "w", mrKey: MR_A, input: MILLION });
  expect(usageMr(dbPath, MR_A)!.runs[0]!.kind).toBe("work");
  expect(usageMrs(dbPath, { now: NOW }).mrs[0]!.costByKind.work).toBeCloseTo(5, 6);
});

test("weeks start on Monday local time", () => {
  const monday = new Date(2026, 9, 26).getTime();
  const nextMonday = new Date(2026, 10, 2).getTime();
  run("w", { mrKey: MR_A });
  message({ runId: "w", mrKey: MR_A, input: 1, ts: nextMonday - 1 });
  message({ runId: "w", mrKey: MR_A, input: 2, ts: monday });
  message({ runId: "w", mrKey: MR_A, input: 4, ts: nextMonday });
  const { weeks } = usageTrends(dbPath, { days: 30, now: NOW });
  expect(weeks.map((w) => [w.weekStart, w.totals.input])).toEqual([
    [monday, 3],
    [nextMonday, 4],
  ]);
});

test("a week keeps local midnight across a daylight saving change", () => {
  const saved = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const now = new Date(2026, 10, 18, 12).getTime();
    const mondays = [
      new Date(2026, 9, 26).getTime(),
      new Date(2026, 10, 2).getTime(),
      new Date(2026, 10, 9).getTime(),
    ];
    run("w", { mrKey: MR_A });
    for (const monday of mondays) {
      message({ runId: "w", mrKey: MR_A, input: 1, ts: monday });
      message({ runId: "w", mrKey: MR_A, input: 1, ts: monday - 1 });
    }
    const { weeks } = usageTrends(dbPath, { days: 40, now });
    expect(weeks.map((w) => w.weekStart)).toEqual([new Date(2026, 9, 19).getTime(), ...mondays]);
    expect(weeks.map((w) => w.totals.input)).toEqual([1, 2, 2, 1]);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test("trends split by kind, pipeline and model", () => {
  run("w", { workType: "feature", mrKey: MR_A, pipeline: "work" });
  run("r", { workType: "receive-review", mrKey: MR_A, pipeline: "respond" });
  agentLink("s-doc", "agent-1", "doctor", MR_A);
  message({ runId: "w", mrKey: MR_A, input: MILLION });
  message({ runId: "r", mrKey: MR_A, input: MILLION, model: "claude-sonnet-5" });
  message({ session: "s-doc", mrKey: MR_A, input: MILLION, attribution: "session" });
  const { weeks, byPipeline, byModel, totals } = usageTrends(dbPath, { days: 7, now: NOW });
  expect(weeks).toHaveLength(1);
  expect(weeks[0]!.byKind.work.cost).toBeCloseTo(5, 6);
  expect(weeks[0]!.byKind.respond.input).toBe(MILLION);
  expect(weeks[0]!.byKind.doctor.input).toBe(MILLION);
  expect(weeks[0]!.byKind.other.input).toBe(0);
  expect(totals.input).toBe(3 * MILLION);
  expect(Object.fromEntries(byPipeline.map((p) => [String(p.pipeline), p.totals.input]))).toEqual({
    work: MILLION,
    respond: MILLION,
    null: MILLION,
  });
  expect(Object.fromEntries(byModel.map((m) => [m.model, m.totals.input]))).toEqual({
    [OPUS]: 2 * MILLION,
    "claude-sonnet-5": MILLION,
  });
});

test("trends skip unattributed and out of range messages", () => {
  run("w", { mrKey: MR_A });
  message({ runId: "w", mrKey: MR_A, input: 1, ts: NOW - DAY });
  message({ session: "s-loose", input: 2, ts: NOW - DAY, attribution: "none" });
  message({ runId: "w", mrKey: MR_A, input: 4, ts: NOW - 8 * DAY });
  expect(usageTrends(dbPath, { days: 7, now: NOW }).totals.input).toBe(1);
});

test("the trends repo filter falls back to the run repo with no MR", () => {
  const other = "remote:github.com%2Facme%2Fother";
  run("mine", { repo: REPO, mrKey: null });
  run("theirs", { repo: other, mrKey: null });
  run("moved", { repo: other, mrKey: MR_A });
  message({ runId: "mine", input: 1 });
  message({ runId: "theirs", input: 2 });
  message({ runId: "moved", mrKey: MR_A, input: 4 });
  message({ runId: "moved", mrKey: `${other}!9`, input: 8 });
  expect(usageTrends(dbPath, { days: 7, repo: REPO, now: NOW }).totals.input).toBe(5);
});

test("status reports the sweep, rows and gaps", () => {
  const meta = db.query("INSERT INTO usage_meta (key, value) VALUES (?, ?)");
  meta.run("last_sweep_at", String(NOW));
  meta.run("last_sweep_ms", "1500");
  meta.run("skipped_lines", "2");
  meta.run("conflicts", "3");
  run("w", { mrKey: MR_A });
  runLink("s-1", "w");
  runLink("s-gone", "w");
  agentLink("s-gone", "agent-1", "other", null);
  db.query("INSERT INTO usage_files (path, session_id) VALUES ('/t/s-1.jsonl', 's-1')").run();
  db.query("INSERT INTO usage_files (path, session_id) VALUES ('/t/null.jsonl', NULL)").run();
  message({ runId: "w", mrKey: MR_A, input: 1 });
  message({ runId: "w", mrKey: MR_A, input: 1 });
  message({ runId: "w", model: "claude-future-9", input: 1 });
  message({ runId: "w", model: "claude-future-9-20270101", input: 1 });
  expect(usageStatus(dbPath)).toEqual({
    lastSweepAt: NOW,
    lastSweepMs: 1500,
    messages: 4,
    runs: 1,
    skippedLines: 2,
    conflicts: 3,
    skippedRate: 2 / 6,
    unpricedModels: ["claude-future-9", "claude-future-9-20270101"],
    sessionsMissingTranscript: 1,
  });
});
