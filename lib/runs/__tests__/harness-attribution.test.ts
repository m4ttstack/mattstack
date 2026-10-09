import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CallerContext, NativeSessionRef, Observation, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { RunFieldRow, RunStageRow, RunSummary } from "../../../packages/rt-client/src/commands.ts";
import { runWriteVerb } from "../../../commands/runs-write.ts";
import { __test__ as observations, recordObservation, STALE_OBSERVATION_MS } from "../../agent-integrations/observation-store.ts";
import { evaluateStop } from "../../agent-integrations/policy.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { openStateDb } from "../../state/db.ts";
import { computeAttention } from "../attention.ts";
import { recordIdentity } from "../identity.ts";
import { boundSessionFromStore, livenessFrom } from "../liveness.ts";
import { resolveOwnedRun, resolveRunDb } from "../resolve-db.ts";
import { runStart } from "../start.ts";
import { bindRunSession } from "../store.ts";
import { decisionRecord, fieldSet, openRunDb, stageEnd, stageStart } from "../write.ts";

let dir = "";
let root = "";
let state: Database;
let origRoot: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-harness-attr-"));
  root = join(dir, "runs");
  origRoot = process.env.RT_RUNS_ROOT;
  process.env.RT_RUNS_ROOT = root;
  state = openStateDb(join(dir, "state.db"));
});

afterEach(() => {
  state.close();
  if (origRoot === undefined) delete process.env.RT_RUNS_ROOT;
  else process.env.RT_RUNS_ROOT = origRoot;
  rmSync(dir, { recursive: true, force: true });
});

const claude = (value: string): NativeSessionRef => ({ harness: "claude", profile: "default", kind: "id", value });
const codex = (value: string): NativeSessionRef => ({ harness: "codex", profile: "default", kind: "id", value });

function bind(identity: string, native: NativeSessionRef, pane?: string): SessionBinding {
  const store = createSessionStore(state);
  const r = store.bind(store.reserve({ identity }), native, pane ? { mode: "herdr", pane } : { mode: "headless" });
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

const ctx = (binding: SessionBinding): CallerContext => ({ binding });

function start(runId: string, o: { now: number; worktree?: string; env?: NodeJS.ProcessEnv; binding?: SessionBinding }): string {
  const r = runStart(root, { repo: "demo", workType: "fix", pipeline: "default", runId, now: o.now, env: o.env ?? {}, ...(o.binding && { binding: o.binding }) });
  if (!r.ok) throw new Error(r.error);
  const db = openRunDb(r.runDb);
  if (o.worktree) fieldSet(db, "worktree", o.worktree, "provision", o.now);
  db.close();
  return r.runDb;
}

type Rows = { stages: unknown[]; decisions: unknown[]; fields: Record<string, { value: string; at: number; produced_by: string }> };

function rows(path: string): Rows {
  const db = new Database(path, { readonly: true });
  try {
    const fields: Rows["fields"] = {};
    for (const f of db.query("SELECT key, value, produced_by, at FROM fields").all() as { key: string; value: string; produced_by: string; at: number }[]) {
      fields[f.key] = { value: f.value, at: f.at, produced_by: f.produced_by };
    }
    return {
      stages: db.query("SELECT * FROM stages ORDER BY started_at, attempt").all(),
      decisions: db.query("SELECT * FROM decisions ORDER BY decided_at").all(),
      fields,
    };
  } finally {
    db.close();
  }
}

const deps = (cwd = "/elsewhere") => ({ root, cwd, stateDb: state });

describe("recordIdentity writes the bound session, not inherited env", () => {
  test("a Codex worker that inherited the controller's pane and Claude session records its own binding", () => {
    const binding = bind("worker", codex("thread-1"), "w1:p2");
    const db = openRunDb(start("r1", { now: 1000 }));
    recordIdentity(db, { HERDR_PANE_ID: "w9:p9", CLAUDE_CODE_SESSION_ID: "controller" }, 2000, binding);
    db.close();
    const f = rows(join(root, "demo", "r1", "state.db")).fields;
    expect(f["herdr-pane"]?.value).toBe("w1:p2");
    expect(f["session-key"]?.value).toBe(binding.key);
    expect(f["claude-session"]).toBeUndefined();
  });

  test("a bound Claude session records its native id under claude-session, so the Stop hook still finds it", () => {
    const binding = bind("lead", claude("sess-bound"), "w1:p3");
    const f = rows(start("r1", { now: 1000, env: { CLAUDE_CODE_SESSION_ID: "sess-env", HERDR_PANE_ID: "w9:p9" }, binding })).fields;
    expect(f["claude-session"]?.value).toBe("sess-bound");
    expect(f["session-key"]?.value).toBe(binding.key);
    expect(f["herdr-pane"]?.value).toBe("w1:p3");
  });

  test("a headless binding records no pane at all, never the environment's", () => {
    const binding = bind("worker", codex("thread-2"));
    const f = rows(start("r1", { now: 1000, env: { HERDR_PANE_ID: "w9:p9" }, binding })).fields;
    expect(f["herdr-pane"]).toBeUndefined();
    expect(f["session-key"]?.value).toBe(binding.key);
  });

  test("a visible and a background pane ref are stored as the binding names them", () => {
    const raw = bind("a", codex("thread-a"), "w1:p2");
    const bg = bind("b", codex("thread-b"), "bg:w1:p2");
    expect(rows(start("ra", { now: 1000, binding: raw })).fields["herdr-pane"]?.value).toBe("w1:p2");
    expect(rows(start("rb", { now: 1000, binding: bg })).fields["herdr-pane"]?.value).toBe("bg:w1:p2");
  });

  test("bindRunSession binds an existing run, and an unchanged binding never bumps its timestamp", () => {
    const binding = bind("worker", codex("thread-1"), "w1:p2");
    const path = start("r1", { now: 1000 });
    bindRunSession(path, binding);
    const first = rows(path).fields["session-key"]!;
    expect(first.value).toBe(binding.key);
    bindRunSession(path, binding);
    expect(rows(path).fields["session-key"]!.at).toBe(first.at);
  });
});

describe("two runs in one directory cannot borrow ownership", () => {
  test("unresolved ownership refuses even though one run is newest in the caller's worktree", () => {
    const tree = join(dir, "tree");
    const a = bind("a", codex("thread-a"), "w1:p1");
    const b = bind("b", codex("thread-b"), "w1:p2");
    const stranger = bind("c", codex("thread-c"), "w1:p3");
    const dbA = start("r-a", { now: 1000, worktree: tree, binding: a });
    const dbB = start("r-b", { now: 2000, worktree: tree, binding: b });

    expect(resolveRunDb({ RT_RUNS_ROOT: root }, tree)).toEqual({ ok: true, db: dbB, resolved: "worktree" });
    const res = resolveOwnedRun(ctx(stranger), undefined, deps(tree));
    expect(res.ok).toBe(false);
    expect(resolveOwnedRun(ctx(a), undefined, deps(tree))).toEqual({ ok: true, data: { db: dbA, runId: "r-a" } });
    expect(resolveOwnedRun(ctx(b), undefined, deps(tree))).toEqual({ ok: true, data: { db: dbB, runId: "r-b" } });
  });

  test("a write from a bound caller never lands on the newest run in its directory", async () => {
    const tree = join(dir, "tree");
    const a = bind("a", codex("thread-a"), "w1:p1");
    const b = bind("b", codex("thread-b"), "w1:p2");
    const dbA = start("r-a", { now: 1000, worktree: tree, binding: a });
    const dbB = start("r-b", { now: 2000, worktree: tree, binding: b });
    const r = await runWriteVerb("stage-start", ["--stage", "plan"], { RT_RUNS_ROOT: root }, tree, { caller: { ok: true, data: ctx(a) } });
    expect(JSON.parse(r.out)).toEqual({ ok: true, runDbResolved: "session" });
    expect(rows(dbA).stages).toHaveLength(1);
    expect(rows(dbB).stages).toHaveLength(0);
  });

  test("two running runs owned by one session pick the one whose worktree holds the cwd, else refuse", () => {
    const a = bind("a", codex("thread-a"), "w1:p1");
    const one = join(dir, "one");
    const two = join(dir, "two");
    const dbOne = start("r-1", { now: 1000, worktree: one, binding: a });
    start("r-2", { now: 2000, worktree: two, binding: a });
    expect(resolveOwnedRun(ctx(a), undefined, deps(one))).toEqual({ ok: true, data: { db: dbOne, runId: "r-1" } });
    const res = resolveOwnedRun(ctx(a), undefined, deps("/elsewhere"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toContain("r-1, r-2");
  });
});

describe("explicit database does not bypass ownership", () => {
  test("a foreign RT_RUN_DB is refused", () => {
    const a = bind("a", codex("thread-a"), "w1:p1");
    const b = bind("b", codex("thread-b"), "w1:p2");
    const dbA = start("r-a", { now: 1000, binding: a });
    const dbB = start("r-b", { now: 2000, binding: b });
    const res = resolveOwnedRun(ctx(a), dbB, deps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("refused");
    expect(resolveOwnedRun(ctx(a), dbA, deps())).toEqual({ ok: true, data: { db: dbA, runId: "r-a" } });
  });

  test("a run no session owns is not adopted through an explicit path", () => {
    const a = bind("a", codex("thread-a"), "w1:p1");
    const res = resolveOwnedRun(ctx(a), start("r-none", { now: 1000 }), deps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ambiguous");
  });

  test("the write verb refuses a foreign RT_RUN_DB and writes nothing", async () => {
    const a = bind("a", codex("thread-a"), "w1:p1");
    const b = bind("b", codex("thread-b"), "w1:p2");
    const dbB = start("r-b", { now: 1000, binding: b });
    const r = await runWriteVerb("stage-start", ["--stage", "plan"], { RT_RUNS_ROOT: root, RT_RUN_DB: dbB }, "/", { caller: { ok: true, data: ctx(a) } });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).ok).toBe(false);
    expect(rows(dbB).stages).toHaveLength(0);
  });

  test("a caller that cannot be attributed is refused a write", async () => {
    const dbB = start("r-b", { now: 1000 });
    const r = await runWriteVerb("stage-start", ["--stage", "plan"], { RT_RUNS_ROOT: root, RT_RUN_DB: dbB }, "/", {
      caller: { ok: false, error: { code: "ambiguous", message: "two sessions" } },
    });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out)).toEqual({ ok: false, error: "this call cannot be attributed to a session: two sessions" });
  });

  test("a read naming its store never needs an attributable caller, so the Stop hook's snapshot still reads", async () => {
    const binding = bind("lead", claude("sess-1"), "w1:p1");
    const path = start("r1", { now: 1000, binding });
    const r = await runWriteVerb("snapshot", [], { RT_RUNS_ROOT: root, RT_RUN_DB: path }, "/", {
      caller: { ok: false, error: { code: "ambiguous", message: "two sessions" } },
    });
    const body = JSON.parse(r.out);
    expect(body.ok).toBe(true);
    expect(body.fields.find((f: { key: string }) => f.key === "claude-session").value).toBe("sess-1");
  });

  test("the environment path (switch off, or an unbound Claude session) keeps today's behavior", async () => {
    const dbB = start("r-b", { now: 1000 });
    const r = await runWriteVerb("stage-start", ["--stage", "plan"], { RT_RUNS_ROOT: root, RT_RUN_DB: dbB }, "/", { caller: null });
    expect(JSON.parse(r.out)).toEqual({ ok: true });
    expect(rows(dbB).stages).toHaveLength(1);
  });
});

describe("legacy Claude field migrates by provenance", () => {
  function legacyRun(runId: string, session: string, now: number): string {
    const path = start(runId, { now, env: { CLAUDE_CODE_SESSION_ID: session, HERDR_PANE_ID: "w4:p4" } });
    const db = openRunDb(path);
    stageStart(db, "plan", {}, now + 10);
    stageEnd(db, "plan", "done", { now: now + 20 });
    stageStart(db, "implement", {}, now + 30);
    fieldSet(db, "branch", "goodwin/x", "plan", now + 15);
    decisionRecord(db, { contract: "execution-strategy@1", scope: "run", selection: '{"tier":"direct-tdd"}', decidedBy: "stage-plan", now: now + 16 });
    db.close();
    return path;
  }

  test("the proven owner's run keeps every stage, decision and timestamp and gains its session key", () => {
    const path = legacyRun("r-legacy", "claude-1", 1000);
    const before = rows(path);
    const binding = bind("lead", claude("claude-1"), "w4:p4");
    expect(resolveOwnedRun(ctx(binding), undefined, deps())).toEqual({ ok: true, data: { db: path, runId: "r-legacy" } });
    const after = rows(path);
    expect(after.stages).toEqual(before.stages);
    expect(after.decisions).toEqual(before.decisions);
    const { "session-key": key, ...rest } = after.fields;
    expect(rest).toEqual(before.fields);
    expect(key).toEqual({ value: binding.key, at: before.fields["claude-session"]!.at, produced_by: "run" });
  });

  test("a legacy run another bound session proves is foreign, and an unprovable one stays unbound", () => {
    legacyRun("r-other", "claude-other", 1000);
    const unproven = legacyRun("r-unknown", "claude-nobody", 2000);
    bind("other", claude("claude-other"), "w5:p5");
    const me = bind("me", claude("claude-me"), "w6:p6");
    expect(resolveOwnedRun(ctx(me), undefined, deps()).ok).toBe(false);
    const explicit = resolveOwnedRun(ctx(me), unproven, deps());
    expect(explicit.ok).toBe(false);
    if (!explicit.ok) expect(explicit.error.message).toContain("cannot be proven");
    const other = resolveOwnedRun(ctx(me), join(root, "demo", "r-other", "state.db"), deps());
    if (!other.ok) expect(other.error.message).toContain("belongs to another session");
    expect(other.ok).toBe(false);
    expect(rows(unproven).fields["session-key"]).toBeUndefined();
  });

  test("pending work still prevents the owner's stop after migration", async () => {
    const path = legacyRun("r-legacy", "claude-1", Date.now() - 1000);
    const binding = bind("lead", claude("claude-1"), "w4:p4");
    expect(resolveOwnedRun(ctx(binding), undefined, deps()).ok).toBe(true);
    expect(await evaluateStop(ctx(binding), { onUnavailable: () => {} })).toEqual({ ok: true, data: "continue" });
    const db = openRunDb(path);
    fieldSet(db, "waiting-gate", "gate-1", "implement", Date.now() + 1000);
    db.close();
    expect(await evaluateStop(ctx(binding), { onUnavailable: () => {} })).toEqual({ ok: true, data: "allow" });
  });
});

describe("continuation enforcement by session key", () => {
  test("a Codex session's open stage blocks its stop; a stranger's does not", async () => {
    const worker = bind("worker", codex("thread-1"), "w1:p2");
    const stranger = bind("stranger", codex("thread-2"), "w1:p3");
    const path = start("r1", { now: Date.now() - 1000, binding: worker });
    const db = openRunDb(path);
    stageStart(db, "implement", {}, Date.now() - 500, worker);
    db.close();
    expect(await evaluateStop(ctx(worker), { onUnavailable: () => {} })).toEqual({ ok: true, data: "continue" });
    expect(await evaluateStop(ctx(stranger), { onUnavailable: () => {} })).toEqual({ ok: true, data: "allow" });
  });

  test("after /clear a Claude session's stop sees only runs recorded under its new id, as the shell hook does", async () => {
    const original = bind("lead", claude("sess-1"), "w1:p1");
    const path = start("r1", { now: Date.now() - 1000, binding: original });
    const db = openRunDb(path);
    stageStart(db, "implement", {}, Date.now() - 500, original);
    db.close();
    const continued = createSessionStore(state).continueNative(original.key, original.attachment.generation, claude("sess-2"));
    if (!continued.ok) throw new Error(continued.error.message);
    expect(await evaluateStop(ctx(continued.data), { onUnavailable: () => {} })).toEqual({ ok: true, data: "allow" });
    expect(resolveOwnedRun(ctx(continued.data), undefined, deps())).toEqual({ ok: true, data: { db: path, runId: "r1" } });
    const again = openRunDb(path);
    stageStart(again, "review", {}, Date.now(), continued.data);
    again.close();
    expect(await evaluateStop(ctx(continued.data), { onUnavailable: () => {} })).toEqual({ ok: true, data: "continue" });
  });
});

describe("attention attributes a run through its bound session", () => {
  test("a Codex run with no Claude session mirrors its bound pane's blocked agent", () => {
    const run: RunSummary = {
      id: "r1", repo: "demo", work_type: "fix", pipeline: "default", status: "running", current_stage: "implement",
      spawned_by: null, started_at: 1000, ended_at: null, pack_commits: null, pack_dirty: 0,
      attention: { needs: false, reason: null, evidence: "" }, last_event_at: 1000, ticket: null, branch: null,
    };
    const stages: RunStageRow[] = [{ name: "implement", status: "running", attempt: 1, started_at: 1000, ended_at: null, reason: null, detail_path: null }];
    const fields: RunFieldRow[] = [{ key: "session-key", value: "key-1", produced_by: "run", at: 1000 }];
    const liveness = livenessFrom(
      [{ status: "blocked", pane: "w1:p2", session: null, cwds: [] }],
      (key) => (key === "key-1" ? { session: "thread-1", pane: "w1:p2" } : null),
    );
    expect(computeAttention(run, stages, fields, [], 2000, liveness)).toEqual({
      needs: true, reason: "blocked", evidence: "agent waiting for input in pane w1:p2",
    });
  });
});

describe("run liveness reads the session's own observations", () => {
  const NOW = 10_000_000;
  const quiet = (key: string) => {
    const run: RunSummary = {
      id: "r1", repo: "demo", work_type: "fix", pipeline: "default", status: "running", current_stage: "implement",
      spawned_by: null, started_at: 1000, ended_at: null, pack_commits: null, pack_dirty: 0,
      attention: { needs: false, reason: null, evidence: "" }, last_event_at: 1000, ticket: null, branch: null,
    };
    const stages: RunStageRow[] = [{ name: "implement", status: "running", attempt: 1, started_at: 1000, ended_at: null, reason: null, detail_path: null }];
    const fields: RunFieldRow[] = [
      { key: "session-key", value: key, produced_by: "run", at: 1000 },
      { key: "claude-session", value: "sess-1", produced_by: "run", at: 1000 },
    ];
    return { run, stages, fields };
  };
  const lookup = (enabled = true) => (key: string) => boundSessionFromStore(key, { db: state, enabled: () => enabled, now: () => NOW });
  const reading = (binding: SessionBinding, over: Partial<Observation> = {}): Observation => ({
    connectivity: "connected", execution: "working", background: "inactive", observedAt: NOW - 1000, source: "claude-mod",
    generation: binding.attachment.generation, ...over,
  });

  beforeEach(() => observations.reset());
  afterEach(() => observations.reset());

  test("a session its mod reports working is never marked stale, however long its run is quiet", () => {
    const binding = bind("lead", claude("sess-1"), "w1:p1");
    const { run, stages, fields } = quiet(binding.key);
    const liveness = () => livenessFrom([], lookup());
    expect(computeAttention(run, stages, fields, [], NOW, liveness()).reason).toBe("stale");

    recordObservation(binding.key, reading(binding), "push");
    expect(computeAttention(run, stages, fields, [], NOW, liveness())).toEqual({ needs: false, reason: null, evidence: "" });
  });

  test("an idle, stale, polled or earlier-generation reading, or the switch off, leaves today's ladder", () => {
    const binding = bind("lead", claude("sess-1"), "w1:p1");
    const { run, stages, fields } = quiet(binding.key);
    const cases: [Observation, "poll" | "push", boolean][] = [
      [reading(binding, { execution: "idle" }), "push", true],
      [reading(binding, { observedAt: NOW - STALE_OBSERVATION_MS - 1 }), "push", true],
      [reading(binding), "poll", true],
      [reading(binding, { generation: binding.attachment.generation - 1 }), "push", true],
      [reading(binding), "push", false],
    ];
    for (const [observation, origin, enabled] of cases) {
      observations.reset();
      recordObservation(binding.key, observation, origin);
      expect(computeAttention(run, stages, fields, [], NOW, livenessFrom([], lookup(enabled))).reason).toBe("stale");
    }
  });
});
