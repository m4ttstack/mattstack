import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { attributeMessages, isFinalRun } from "../attribute.ts";
import { openUsageDb } from "../store.ts";

const M = "machine-a";
const MR_A = "remote:github.com%2Facme%2Fwidgets!1";
const MR_B = "remote:github.com%2Facme%2Fwidgets!2";
let dir: string;
let db: ReturnType<typeof openUsageDb>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-attribute-"));
  db = openUsageDb(join(dir, "usage.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface RunSeed {
  status?: string;
  startedAt: number;
  endedAt?: number | null;
  mrKey?: string | null;
  session?: string;
  machine?: string;
}

function run(id: string, o: RunSeed): void {
  const machine = o.machine ?? M;
  db.query(
    `INSERT INTO usage_runs (machine_id, run_id, status, started_at, ended_at, mr_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(machine, id, o.status ?? "running", o.startedAt, o.endedAt ?? null, o.mrKey ?? null);
  db.query(
    "INSERT INTO usage_sessions (machine_id, session_id, source, ref) VALUES (?, ?, 'run', ?)",
  ).run(machine, o.session ?? "s-1", id);
}

function stage(
  runId: string,
  name: string,
  attempt: number,
  startedAt: number | null,
  endedAt: number | null,
): void {
  db.query(
    `INSERT INTO usage_stages (machine_id, run_id, name, attempt, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'done', ?, ?)`,
  ).run(M, runId, name, attempt, startedAt, endedAt);
}

function agentLink(ref: string, mrKey: string | null, session = "s-1"): void {
  db.query(
    `INSERT INTO usage_sessions (machine_id, session_id, source, ref, agent_mr_key, agent_kind)
     VALUES (?, ?, 'agent', ?, ?, 'other')`,
  ).run(M, session, ref, mrKey);
}

function message(
  id: string,
  ts: number,
  o: { session?: string; subagent?: string; machine?: string } = {},
): void {
  db.query(
    `INSERT INTO usage_messages (machine_id, message_id, session_id, ts, subagent_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(o.machine ?? M, id, o.session ?? "s-1", ts, o.subagent ?? null);
}

function setLastSweep(at: number): void {
  db.query(
    "INSERT INTO usage_meta (key, value) VALUES ('last_sweep_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(String(at));
}

function row(id: string, machine = M) {
  return db
    .query(
      `SELECT run_id, stage, attempt, mr_key, attribution FROM usage_messages
       WHERE machine_id = ? AND message_id = ?`,
    )
    .get(machine, id);
}

interface Expected {
  run_id: string | null;
  stage: string | null;
  attempt: number | null;
  mr_key: string | null;
  attribution: string;
}

const expected = (o: Partial<Expected>): Expected => ({
  run_id: null,
  stage: null,
  attempt: null,
  mr_key: null,
  attribution: "none",
  ...o,
});

test("inside a stage window gives attribution stage", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done", mrKey: MR_A });
  stage("run-1", "build", 1, 200, 400);
  message("m", 300);
  expect(attributeMessages(db, M)).toEqual({ changed: 1 });
  expect(row("m")).toEqual(
    expected({ run_id: "run-1", stage: "build", attempt: 1, mr_key: MR_A, attribution: "stage" }),
  );
});

test("inside a run, between stages, gives attribution run with a null stage", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done", mrKey: MR_A });
  stage("run-1", "plan", 1, 100, 200);
  stage("run-1", "build", 1, 400, 500);
  message("m", 300);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-1", mr_key: MR_A, attribution: "run" }));
});

test("overlapping runs pick the latest started", () => {
  run("run-early", { startedAt: 100, endedAt: 900, status: "done", mrKey: MR_A });
  run("run-late", { startedAt: 200, endedAt: 300, status: "done", mrKey: MR_B });
  message("inside-both", 250);
  message("inside-early-only", 500);
  attributeMessages(db, M);
  expect(row("inside-both")).toEqual(
    expected({ run_id: "run-late", mr_key: MR_B, attribution: "run" }),
  );
  expect(row("inside-early-only")).toEqual(
    expected({ run_id: "run-early", mr_key: MR_A, attribution: "run" }),
  );
});

test("a retried stage picks the latest attempt", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done" });
  stage("run-1", "build", 1, 200, 500);
  stage("run-1", "build", 2, 300, 600);
  stage("run-1", "ship", 1, 700, 800);
  stage("run-1", "ship", 2, 700, 800);
  message("overlap", 400);
  message("first-only", 250);
  message("same-start", 750);
  attributeMessages(db, M);
  expect(row("overlap")).toEqual(
    expected({ run_id: "run-1", stage: "build", attempt: 2, attribution: "stage" }),
  );
  expect(row("first-only")).toEqual(
    expected({ run_id: "run-1", stage: "build", attempt: 1, attribution: "stage" }),
  );
  expect(row("same-start")).toEqual(
    expected({ run_id: "run-1", stage: "ship", attempt: 2, attribution: "stage" }),
  );
});

test("a stage takes only messages from its own run", () => {
  run("run-early", { startedAt: 100, endedAt: 900, status: "done" });
  stage("run-early", "build", 1, 200, 800);
  run("run-late", { startedAt: 300, endedAt: 400, status: "done" });
  message("m", 350);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-late", attribution: "run" }));
});

test("a live run has an open window", () => {
  run("run-1", { startedAt: 100, mrKey: MR_A });
  stage("run-1", "build", 1, 200, null);
  message("m", 1_000_000);
  attributeMessages(db, M);
  expect(row("m")).toEqual(
    expected({ run_id: "run-1", stage: "build", attempt: 1, mr_key: MR_A, attribution: "stage" }),
  );
});

test("a null ended_at is open-ended whatever the status", () => {
  run("run-1", { startedAt: 100, status: "failed" });
  message("m", 1_000_000);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-1", attribution: "run" }));
});

test("window bounds are inclusive at both ends", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done" });
  stage("run-1", "plan", 1, 100, 500);
  stage("run-1", "build", 1, 500, 900);
  message("at-run-start", 100);
  message("at-stage-seam", 500);
  message("at-run-end", 900);
  attributeMessages(db, M);
  expect(row("at-run-start")).toEqual(
    expected({ run_id: "run-1", stage: "plan", attempt: 1, attribution: "stage" }),
  );
  expect(row("at-stage-seam")).toEqual(
    expected({ run_id: "run-1", stage: "build", attempt: 1, attribution: "stage" }),
  );
  expect(row("at-run-end")).toEqual(
    expected({ run_id: "run-1", stage: "build", attempt: 1, attribution: "stage" }),
  );
});

test("a stage that never started holds nothing", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done" });
  stage("run-1", "ship", 1, null, null);
  message("m", 300);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-1", attribution: "run" }));
});

test("before the first run uses the next run, attribution session", () => {
  run("run-later", { startedAt: 500, endedAt: 600, status: "done", mrKey: MR_B });
  run("run-next", { startedAt: 300, endedAt: 400, status: "done", mrKey: MR_A });
  stage("run-next", "plan", 1, 300, 400);
  message("m", 100);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-next", mr_key: MR_A, attribution: "session" }));
});

test("after a run uses the previous run, attribution session", () => {
  run("run-1", { startedAt: 100, endedAt: 200, status: "done", mrKey: MR_A });
  message("m", 300);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-1", mr_key: MR_A, attribution: "session" }));
});

test("between runs the earlier run wins over the later one", () => {
  run("run-1", { startedAt: 100, endedAt: 200, status: "done", mrKey: MR_A });
  run("run-2", { startedAt: 301, endedAt: 400, status: "done", mrKey: MR_B });
  message("m", 300);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-1", mr_key: MR_A, attribution: "session" }));
});

test("the previous run is the one that ended nearest, not the one started last", () => {
  run("run-long", { startedAt: 100, endedAt: 800, status: "done", mrKey: MR_A });
  run("run-short", { startedAt: 200, endedAt: 300, status: "done", mrKey: MR_B });
  message("m", 900);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-long", mr_key: MR_A, attribution: "session" }));
});

test("agent-only sessions get mr_key with a null run_id, attribution session", () => {
  agentLink("ag-1", MR_A);
  message("m", 100);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ mr_key: MR_A, attribution: "session" }));
});

test("an agent link with no MR and no run gets attribution none", () => {
  agentLink("ag-1", null);
  message("m", 100);
  expect(attributeMessages(db, M)).toEqual({ changed: 0 });
  expect(row("m")).toEqual(expected({}));
});

test("several agent links take the first MR by ref", () => {
  agentLink("ag-2", MR_B);
  agentLink("ag-1", MR_A);
  agentLink("ag-0", null);
  message("m", 100);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ mr_key: MR_A, attribution: "session" }));
});

test("an unlinked session gets attribution none", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done", mrKey: MR_A });
  message("m", 300, { session: "s-unlinked" });
  expect(attributeMessages(db, M)).toEqual({ changed: 0 });
  expect(row("m")).toEqual(expected({}));
});

test("mr_key comes from the run first", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done", mrKey: MR_A });
  agentLink("ag-1", MR_B);
  message("m", 300);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-1", mr_key: MR_A, attribution: "run" }));
});

test("a run with no MR falls back to the agent link", () => {
  run("run-1", { startedAt: 100, endedAt: 200, status: "done" });
  agentLink("ag-1", MR_B);
  message("in-run", 150);
  message("after-run", 300);
  attributeMessages(db, M);
  expect(row("in-run")).toEqual(expected({ run_id: "run-1", mr_key: MR_B, attribution: "run" }));
  expect(row("after-run")).toEqual(
    expected({ run_id: "run-1", mr_key: MR_B, attribution: "session" }),
  );
});

test("a run gaining an mr later updates its messages", () => {
  run("run-1", { startedAt: 100 });
  message("m", 300);
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-1", attribution: "run" }));
  db.query("UPDATE usage_runs SET mr_key = ? WHERE run_id = 'run-1'").run(MR_A);
  expect(attributeMessages(db, M)).toEqual({ changed: 1 });
  expect(row("m")).toEqual(expected({ run_id: "run-1", mr_key: MR_A, attribution: "run" }));
});

test("a stage ending after the message was read moves it off the stage", () => {
  run("run-1", { startedAt: 100 });
  stage("run-1", "build", 1, 200, null);
  message("m", 300);
  attributeMessages(db, M);
  db.query("UPDATE usage_stages SET ended_at = 250").run();
  expect(attributeMessages(db, M)).toEqual({ changed: 1 });
  expect(row("m")).toEqual(expected({ run_id: "run-1", attribution: "run" }));
});

test("a terminal run keeps moving until a later sweep has passed", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done" });
  stage("run-1", "build", 1, 200, 400);
  message("m", 300);
  setLastSweep(500);
  attributeMessages(db, M);
  db.query("UPDATE usage_stages SET ended_at = 250").run();
  expect(attributeMessages(db, M)).toEqual({ changed: 1 });
  expect(row("m")).toEqual(expected({ run_id: "run-1", attribution: "run" }));
});

test("a final run's messages stop changing", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done" });
  stage("run-1", "build", 1, 200, 400);
  message("m", 300);
  attributeMessages(db, M);
  const before = row("m");
  expect(before).toEqual(
    expected({ run_id: "run-1", stage: "build", attempt: 1, attribution: "stage" }),
  );

  setLastSweep(1000);
  db.query("UPDATE usage_stages SET ended_at = 250").run();
  db.query("UPDATE usage_runs SET mr_key = ?").run(MR_A);
  expect(attributeMessages(db, M)).toEqual({ changed: 0 });
  expect(row("m")).toEqual(before);
});

test("a message first seen after its run is final still gets attributed", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done", mrKey: MR_A });
  setLastSweep(1000);
  message("in-run", 300);
  message("follow-up", 950);
  expect(attributeMessages(db, M)).toEqual({ changed: 2 });
  expect(row("in-run")).toEqual(expected({ run_id: "run-1", mr_key: MR_A, attribution: "run" }));
  expect(row("follow-up")).toEqual(
    expected({ run_id: "run-1", mr_key: MR_A, attribution: "session" }),
  );
});

test("a final run does not freeze a live run's messages in the same session", () => {
  run("run-old", { startedAt: 100, endedAt: 200, status: "done" });
  run("run-live", { startedAt: 300 });
  message("frozen", 150);
  message("live", 400);
  attributeMessages(db, M);
  setLastSweep(1000);
  db.query("UPDATE usage_runs SET mr_key = ?").run(MR_A);
  expect(attributeMessages(db, M)).toEqual({ changed: 1 });
  expect(row("frozen")).toEqual(expected({ run_id: "run-old", attribution: "run" }));
  expect(row("live")).toEqual(expected({ run_id: "run-live", mr_key: MR_A, attribution: "run" }));
});

test("a subagent message follows the same rule", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done", mrKey: MR_A });
  stage("run-1", "build", 1, 200, 400);
  message("sub-in-stage", 300, { subagent: "agent-abc" });
  message("sub-after", 950, { subagent: "agent-abc" });
  attributeMessages(db, M);
  expect(row("sub-in-stage")).toEqual(
    expected({ run_id: "run-1", stage: "build", attempt: 1, mr_key: MR_A, attribution: "stage" }),
  );
  expect(row("sub-after")).toEqual(
    expected({ run_id: "run-1", mr_key: MR_A, attribution: "session" }),
  );
});

test("a rerun with nothing new changes nothing", () => {
  run("run-1", { startedAt: 100, mrKey: MR_A });
  stage("run-1", "build", 1, 200, 400);
  agentLink("ag-1", MR_B, "s-agent");
  message("m-1", 300);
  message("m-2", 500);
  message("m-3", 50, { session: "s-agent" });
  expect(attributeMessages(db, M)).toEqual({ changed: 3 });
  expect(attributeMessages(db, M)).toEqual({ changed: 0 });
});

test("another machine's rows are left alone", () => {
  run("run-1", { startedAt: 100, endedAt: 900, status: "done", mrKey: MR_A });
  run("run-other", {
    startedAt: 100,
    endedAt: 900,
    status: "done",
    mrKey: MR_B,
    machine: "machine-b",
  });
  message("m", 300);
  message("m-other", 300, { machine: "machine-b" });
  attributeMessages(db, M);
  expect(row("m")).toEqual(expected({ run_id: "run-1", mr_key: MR_A, attribution: "run" }));
  expect(row("m-other", "machine-b")).toEqual(expected({}));
});

test("isFinalRun needs a terminal run and a sweep after it ended", () => {
  expect(isFinalRun("done", 100, 101)).toBe(true);
  expect(isFinalRun("failed", 100, 101)).toBe(true);
  expect(isFinalRun("running", 100, 101)).toBe(false);
  expect(isFinalRun("done", null, 101)).toBe(false);
  expect(isFinalRun("done", 100, null)).toBe(false);
  expect(isFinalRun("done", 100, 100)).toBe(false);
  expect(isFinalRun("done", 100, 99)).toBe(false);
});
