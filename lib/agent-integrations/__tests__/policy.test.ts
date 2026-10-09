import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import pino from "pino";
import type { CallerContext, Capability, ModBlock, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createGatesStore } from "../../daemon/gates-store.ts";
import { createGateHandlers } from "../../daemon/handlers/gate.ts";
import type { EventsBus } from "../../daemon/events-bus.ts";
import { runStart } from "../../runs/start.ts";
import { findRunsBySession } from "../../runs/store.ts";
import { fieldSet, openRunDb, runStatus, stageStart } from "../../runs/write.ts";
import { gateForkHookEntry } from "../../agent-hooks.ts";
import { buildForkCheckPayload, forkCheckHookOutput, FORK_CHECK_ALLOW } from "../../../commands/gate.ts";
import { createModLinks, TESTED_CLAUDE_CODE } from "../claude/mod-links.ts";
import { sessionModPolicy } from "../claude/mod-path.ts";
import { createClaudePolicy } from "../claude/policy.ts";
import { openStateDb } from "../../state/db.ts";
import { createSessionStore, markBindingReady, readBindingReadiness, withdrawBindingReady } from "../session-store.ts";
import {
  authorizeWorkflowAction, evaluateStop, forkCheckPayloadFor, forkDenyReason, forkVerdict, inspectStop,
  isPolicyUnavailable, policyAttention, stopReason, type PolicyDeps,
} from "../policy.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const STOP_HOOK = join(REPO_ROOT, "plugins/mattstack/hooks/pipeline-gate-stop.sh");
const SID = "11111111-2222-3333-4444-555555555555";

let dir = "";
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-policy-"))); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function binding(value = SID, pane: string | undefined = "w1:p1", harness = "claude"): SessionBinding {
  return {
    key: `key-${value}`, identity: "id-1",
    native: { harness, profile: "default", kind: "id", value },
    attachment: { generation: 3, mode: "herdr", ...(pane !== undefined && { pane }) },
  };
}
const caller = (value = SID, pane?: string): CallerContext => ({ binding: binding(value, pane) });

// ─── Stop characterization ───────────────────────────────────────────────────

type Field = { key: string; value: string; at: number | string };
type StopRun = {
  repo?: string; id: string; status?: string; session?: string | null; startedAt?: number;
  stage?: string; stages?: { name: string; started_at: number }[]; fields?: Field[];
};
type StopCase = {
  name: string; runs: StopRun[];
  /** What `rt runs find --running` lists, newest first; defaults to every running run. */
  find?: string[];
  want: "allow" | "continue" | "unavailable";
  names?: { run: string; stage: string };
};

const DEFAULT_STAGES = [{ name: "plan", started_at: 1000 }, { name: "ship", started_at: 2000 }];

function snapshotOf(r: StopRun): Record<string, unknown> {
  const fields: Field[] = [];
  if (r.session !== null) fields.push({ key: "claude-session", value: r.session ?? SID, at: 1000 });
  fields.push(...(r.fields ?? []));
  return {
    ok: true,
    run: { id: r.id, repo: r.repo ?? "repo-a", status: r.status ?? "running", current_stage: r.stage ?? "ship", started_at: r.startedAt ?? 1000 },
    stages: (r.stages ?? DEFAULT_STAGES).map((s, i) => ({ ...s, status: i === 0 ? "done" : "running", attempt: 1 })),
    fields: fields.map((f) => ({ ...f, produced_by: "work" })),
    decisions: [],
  };
}

const CASES: StopCase[] = [
  { name: "no owned run allows", runs: [], want: "allow" },
  { name: "running run with an open stage asks for continuation", runs: [{ id: "r-open" }], want: "continue", names: { run: "r-open", stage: "ship" } },
  {
    name: "a current hold lets the turn end", want: "allow",
    runs: [{ id: "r-held", fields: [{ key: "hold", value: "parked for the night", at: 3000 }] }],
  },
  {
    name: "a current waiting gate lets the turn end", want: "allow",
    runs: [{ id: "r-wait", fields: [{ key: "waiting-gate", value: "g-17", at: 3000 }] }],
  },
  {
    name: "a stale hold still asks for continuation", want: "continue", names: { run: "r-stale", stage: "ship" },
    runs: [{ id: "r-stale", fields: [{ key: "hold", value: "old", at: 1500 }] }],
  },
  {
    name: "a cleared hold still asks for continuation", want: "continue", names: { run: "r-cleared", stage: "ship" },
    runs: [{ id: "r-cleared", fields: [{ key: "hold", value: "-", at: 3000 }] }],
  },
  {
    name: "a stale waiting gate still asks for continuation", want: "continue", names: { run: "r-wg-stale", stage: "ship" },
    runs: [{ id: "r-wg-stale", fields: [{ key: "waiting-gate", value: "g-1", at: 2000 }] }],
  },
  { name: "an ended run allows", runs: [{ id: "r-done", status: "done" }], find: ["r-done"], want: "allow" },
  { name: "a foreign session's run allows", runs: [{ id: "r-foreign", session: "other-session" }], want: "allow" },
  { name: "a run with no recorded session allows", runs: [{ id: "r-unowned", session: null }], want: "allow" },
  {
    name: "the newest of two owned runs is named", want: "continue", names: { run: "r-new", stage: "ship" },
    runs: [{ id: "r-old", startedAt: 5000 }, { id: "r-new", startedAt: 9000 }], find: ["r-new", "r-old"],
  },
  {
    name: "a held newest run lets the turn end over an older open one", want: "allow",
    runs: [{ id: "r-old2", startedAt: 5000 }, { id: "r-held2", startedAt: 9000, fields: [{ key: "hold", value: "x", at: 3000 }] }],
    find: ["r-held2", "r-old2"],
  },
  {
    name: "an unknown stage is named unknown", want: "continue", names: { run: "r-nostage", stage: "unknown" },
    runs: [{ id: "r-nostage", stage: "" }],
  },
  {
    name: "a current hold beside a waiting gate whose time is not an integer skips the run, as Python evaluates both",
    want: "continue", names: { run: "r-older", stage: "ship" },
    runs: [
      { id: "r-older", startedAt: 5000 },
      { id: "r-badwait", startedAt: 9000, fields: [{ key: "hold", value: "parked", at: 3000 }, { key: "waiting-gate", value: "g-2", at: "soon" }] },
    ],
    find: ["r-badwait", "r-older"],
  },
];

function writeCase(root: string, c: StopCase): { findJson: string } {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dbs = new Map<string, string>();
  for (const r of c.runs) {
    const d = join(root, r.repo ?? "repo-a", r.id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "state.db"), "");
    writeFileSync(join(d, "state.db.snapshot.json"), JSON.stringify(snapshotOf(r)));
    dbs.set(r.id, join(d, "state.db"));
  }
  const listed = c.find ?? c.runs.filter((r) => (r.status ?? "running") === "running").map((r) => r.id);
  const findJson = join(root, "..", "find.json");
  writeFileSync(findJson, JSON.stringify({ ok: true, runs: listed.map((id) => ({ runId: id, runDb: dbs.get(id), status: "running" })) }));
  return { findJson };
}

/** Reads exactly what the shell's fake rt prints. */
function fixtureDeps(findJson: string): PolicyDeps {
  return {
    findRunning: () => (JSON.parse(readFileSync(findJson, "utf8")).runs as { runDb: string }[]).map((r) => r.runDb),
    snapshot: (runDb) => JSON.parse(readFileSync(`${runDb}.snapshot.json`, "utf8")),
    onUnavailable: () => {},
  };
}

const FAKE_RT = `#!/bin/sh
if [ "$1" = "runs" ] && [ "$2" = "find" ]; then cat "$RT_STUB_FIND"; exit 0; fi
[ "$1" = "runs" ] && [ "$2" = "snapshot" ] || exit 2
cat "$RT_RUN_DB.snapshot.json"
`;

function runShell(opts: { findJson?: string; root: string; withRt?: boolean; stdin?: string }): { code: number; stderr: string; stdout: string } {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  if (opts.withRt !== false) {
    writeFileSync(join(bin, "rt"), FAKE_RT);
    chmodSync(join(bin, "rt"), 0o755);
  } else {
    rmSync(join(bin, "rt"), { force: true });
  }
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const r = spawnSync("sh", [STOP_HOOK], {
    input: opts.stdin ?? JSON.stringify({ session_id: SID, hook_event_name: "Stop", stop_hook_active: false }),
    env: {
      HOME: home, PATH: `${bin}:/usr/bin:/bin`, RT_RUNS_ROOT: opts.root,
      ...(opts.findJson && { RT_STUB_FIND: opts.findJson }),
    },
    encoding: "utf8",
  });
  return { code: r.status ?? -1, stderr: r.stderr, stdout: r.stdout };
}

describe("evaluateStop characterizes pipeline-gate-stop.sh", () => {
  for (const c of CASES) {
    test(c.name, async () => {
      const { findJson } = writeCase(join(dir, "runs"), c);
      const verdict = await inspectStop(caller(), fixtureDeps(findJson));
      if (!verdict.ok) throw new Error(verdict.error.message);
      expect(verdict.data.decision).toBe(c.want as "allow" | "continue");
      if (verdict.data.decision === "continue") {
        expect({ run: verdict.data.runId, stage: verdict.data.stage }).toEqual(c.names!);
        expect(verdict.data.reason).toBe(stopReason(c.names!.run, c.names!.stage));
      }
      const plain = await evaluateStop(caller(), fixtureDeps(findJson));
      expect(plain).toEqual({ ok: true, data: c.want as "allow" | "continue" });
    });
  }

  test("a candidate whose snapshot cannot be read is skipped, as the shell's `|| continue` does", async () => {
    const deps: PolicyDeps = {
      findRunning: () => ["/gone/state.db", "/open/state.db"],
      snapshot: (db) => {
        if (db.startsWith("/gone")) throw new Error("no such run");
        return snapshotOf({ id: "r-open" });
      },
      onUnavailable: () => {},
    };
    expect(await evaluateStop(caller(), deps)).toEqual({ ok: true, data: "continue" });
  });

  test("an unavailable verdict raises the native attention condition under its own reason", () => {
    const raised: unknown[] = [];
    policyAttention({ native: { attention: (detail) => { raised.push(detail); } } }, caller(), "stop", "EACCES");
    expect(raised).toEqual([{ reason: "policy-unavailable", harness: "claude", sessionKey: `key-${SID}`, generation: 3, action: "stop", detail: "EACCES" }]);
    expect(() => policyAttention(null, caller(), "stop", "EACCES")).not.toThrow();
  });

  test("an unreadable runs root is unavailable, not allow, and records the caller as unready", async () => {
    const seen: string[] = [];
    const deps: PolicyDeps = {
      findRunning: () => { throw new Error("EACCES"); },
      onUnavailable: (context, action, message) => { seen.push(`${context.binding.key}|${action}|${message}`); },
    };
    const verdict = await evaluateStop(caller(), deps);
    expect(verdict.ok).toBe(false);
    expect(isPolicyUnavailable(verdict)).toBe(true);
    expect(seen).toEqual([`key-${SID}|stop|${verdict.ok ? "" : verdict.error.message}`]);
  });

  test("an unavailable record withdraws readiness for the binding's own generation only", () => {
    const db = openStateDb(join(dir, "state.db"));
    const store = createSessionStore(db);
    const bound = store.bind(store.reserve({ identity: "id-1" }), { harness: "claude", profile: "default", kind: "id", value: SID }, { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    const { key, attachment: { generation } } = bound.data;
    expect(markBindingReady(db, key, generation, ["continuation-policy"]).ok).toBe(true);
    expect(withdrawBindingReady(db, key, generation + 1)).toEqual({ ok: true, data: false });
    expect(readBindingReadiness(db, key)?.generation).toBe(generation);
    expect(withdrawBindingReady(db, key, generation)).toEqual({ ok: true, data: true });
    expect(readBindingReadiness(db, key)?.generation).toBeNull();
    db.close();
  });

  test("the default readers: an unreadable runs root or run DB is unavailable, a missing one is no runs (live-14 D6)", async () => {
    const root = join(dir, "strict-runs");
    const prior = process.env.RT_RUNS_ROOT;
    process.env.RT_RUNS_ROOT = root;
    const quiet: PolicyDeps = { onUnavailable: () => {} };
    try {
      expect(await evaluateStop(caller(), quiet)).toEqual({ ok: true, data: "allow" });

      const started = runStart(root, { repo: "repo-a", workType: "feature", pipeline: "feature", env: { CLAUDE_CODE_SESSION_ID: SID }, now: 1000 });
      if (!started.ok) throw new Error(started.error);
      mkdirSync(join(root, "repo-a", "run-without-db"), { recursive: true });
      expect(await evaluateStop(caller(), quiet)).toEqual({ ok: true, data: "continue" });

      chmodSync(root, 0o000);
      try {
        const verdict = await evaluateStop(caller(), quiet);
        expect(isPolicyUnavailable(verdict)).toBe(true);
        expect(findRunsBySession(SID)).toEqual([]);
      } finally {
        chmodSync(root, 0o755);
      }

      chmodSync(started.runDb, 0o000);
      try {
        const verdict = await evaluateStop(caller(), quiet);
        expect(isPolicyUnavailable(verdict)).toBe(true);
        if (!verdict.ok) expect(verdict.error.message).toContain(started.runDb);
        expect(findRunsBySession(SID)).toEqual([]);
      } finally {
        chmodSync(started.runDb, 0o644);
      }
    } finally {
      if (prior === undefined) delete process.env.RT_RUNS_ROOT;
      else process.env.RT_RUNS_ROOT = prior;
    }
  });

  test("the default readers find the caller's real run and honor a hold set after the stage started", async () => {
    const root = join(dir, "real-runs");
    const prior = process.env.RT_RUNS_ROOT;
    process.env.RT_RUNS_ROOT = root;
    try {
      const started = runStart(root, { repo: "repo-a", workType: "feature", pipeline: "feature", env: { CLAUDE_CODE_SESSION_ID: SID }, now: 1000 });
      if (!started.ok) throw new Error(started.error);
      const db = openRunDb(started.runDb);
      stageStart(db, "ship", { CLAUDE_CODE_SESSION_ID: SID }, 2000);
      db.close();
      const opened = await inspectStop(caller());
      expect(opened).toEqual({
        ok: true, data: { decision: "continue", runId: started.runId, stage: "ship", reason: stopReason(started.runId, "ship") },
      });

      const held = openRunDb(started.runDb);
      fieldSet(held, "hold", "parked", "ship", 3000);
      held.close();
      expect(await evaluateStop(caller())).toEqual({ ok: true, data: "allow" });

      const ended = openRunDb(started.runDb);
      runStatus(ended, "done", 4000);
      ended.close();
      expect(await evaluateStop(caller())).toEqual({ ok: true, data: "allow" });
      expect(await evaluateStop(caller("other-session"))).toEqual({ ok: true, data: "allow" });
    } finally {
      if (prior === undefined) delete process.env.RT_RUNS_ROOT;
      else process.env.RT_RUNS_ROOT = prior;
    }
  });
});

describe("parity: evaluateStop and pipeline-gate-stop.sh decide the same", () => {
  for (const c of CASES) {
    test(c.name, async () => {
      const root = join(dir, "runs");
      const { findJson } = writeCase(root, c);
      const shell = runShell({ findJson, root });
      const policy = await inspectStop(caller(), fixtureDeps(findJson));
      if (!policy.ok) throw new Error(policy.error.message);
      expect(shell.stdout).toBe("");
      if (policy.data.decision === "continue") {
        expect(shell.code).toBe(2);
        expect(shell.stderr).toBe(`${policy.data.reason}\n`);
      } else {
        expect(shell.code).toBe(0);
        expect(shell.stderr).toBe("");
      }
    });
  }

  test("unavailable rt: the shell escapes with exit 0 while the policy reports unavailable, never allow", async () => {
    const root = join(dir, "runs");
    const { findJson } = writeCase(root, { name: "x", runs: [{ id: "r-open" }], want: "continue" });
    const shell = runShell({ findJson, root, withRt: false });
    expect(shell).toEqual({ code: 0, stderr: "", stdout: "" });
    const policy = await evaluateStop(caller(), { findRunning: () => { throw new Error("rt is unavailable"); }, onUnavailable: () => {} });
    expect(isPolicyUnavailable(policy)).toBe(true);
  });
});

// ─── Gate fork-check ────────────────────────────────────────────────────────

const LAUNCH = "herd:acme-x/acme-1234-attorney";
const QUESTIONS = [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }];

function gateHarness() {
  const store = createGatesStore({ dbPath: join(dir, "gates.db"), log: pino({ level: "silent" }) });
  let nextId = 1;
  const bus = { emitAt: () => nextId++ } as unknown as EventsBus;
  const handlers = createGateHandlers(store, bus, () => {}, {
    resolveSubject: ({ sessionId }) => (sessionId === SID ? { ok: true, subject: "run:r1", runId: "r1" } : { ok: false, error: "no subject" }),
  });
  const seen: unknown[] = [];
  const forkCheck: PolicyDeps["forkCheck"] = async (payload) => {
    seen.push(payload);
    const res = await handlers["gate:fork-check"](payload);
    return res.ok ? { ok: true, data: res.data } : { ok: false, error: String(res.error) };
  };
  return { store, forkCheck, seen };
}

describe("authorizeWorkflowAction: ask runs the daemon's fork-check rules", () => {
  test("the caller's session ids, pane, directory and launch subject reach the fork-check, never a native tool name", () => {
    expect(forkCheckPayloadFor(caller(SID, "w9:p4"), LAUNCH, { sessionIds: ["sess-env", SID], cwd: "/does/not/exist" })).toEqual({
      subject: LAUNCH, sessionIds: [SID, "sess-env"], paneId: "w9:p4", worktrees: ["/does/not/exist"],
    });
    expect(forkCheckPayloadFor(caller(), "", { cwd: "/x" })).toBeNull();
  });

  describe("side by side with the Claude hook's own path", () => {
    const noIdentity = () => ({ ok: true as const, data: null });
    async function hookAllows(stdin: unknown, env: NodeJS.ProcessEnv, cwd: string, forkCheck: NonNullable<PolicyDeps["forkCheck"]>) {
      const payload = buildForkCheckPayload(JSON.stringify(stdin), env, cwd, noIdentity);
      const out = forkCheckHookOutput(payload ? await forkCheck(payload) : null);
      return { asked: payload !== null, allow: JSON.stringify(out) === JSON.stringify(FORK_CHECK_ALLOW) };
    }

    test("no launch subject: both allow without asking the daemon", async () => {
      const { forkCheck, seen } = gateHarness();
      expect(await hookAllows({ session_id: SID, cwd: dir }, { CLAUDE_CODE_SESSION_ID: SID }, dir, forkCheck)).toEqual({ asked: false, allow: true });
      expect(await authorizeWorkflowAction(caller(), "ask", "", { forkCheck, caller: { cwd: dir } })).toEqual({ ok: true, data: undefined });
      expect(seen).toHaveLength(0);
    });

    test("an env session id other than the hook's: the gate rt gate ask stamped with the env id allows on both", async () => {
      const { store, forkCheck } = gateHarness();
      store.open({ subject: "mr:x", kind: "plan", questions: QUESTIONS, origin: { presentation: "form", paneId: "w1:p1" }, nudge: { session: "sess-env" } });
      const env = { RT_GATE_SUBJECT: LAUNCH, CLAUDE_CODE_SESSION_ID: "sess-env", HERDR_PANE_ID: "w1:p1" };
      expect(await hookAllows({ session_id: SID, cwd: dir }, env, dir, forkCheck)).toEqual({ asked: true, allow: true });
      expect(await authorizeWorkflowAction(caller(SID, "w1:p1"), "ask", LAUNCH, { forkCheck, caller: { sessionIds: ["sess-env"], cwd: dir } }))
        .toEqual({ ok: true, data: undefined });
      const bare = await authorizeWorkflowAction(caller(SID, "w1:p1"), "ask", LAUNCH, { forkCheck, caller: { cwd: dir } });
      expect(bare.ok ? "ok" : bare.error.code).toBe("refused");
    });

    test("a run gate filed from this worktree allows on both, through either spelling of the directory", async () => {
      const { store, forkCheck } = gateHarness();
      const real = join(dir, "tree");
      const link = join(dir, "tree-link");
      mkdirSync(real);
      symlinkSync(real, link);
      store.open({ subject: "run:r9", kind: "plan", questions: QUESTIONS, origin: { worktree: real } });
      const env = { RT_GATE_SUBJECT: LAUNCH, CLAUDE_CODE_SESSION_ID: "nobody" };
      expect(await hookAllows({ session_id: "nobody", cwd: link }, env, "/x", forkCheck)).toEqual({ asked: true, allow: true });
      expect(await authorizeWorkflowAction(caller("nobody", "w5:p5"), "ask", LAUNCH, { forkCheck, caller: { cwd: link } }))
        .toEqual({ ok: true, data: undefined });
      const elsewhere = await authorizeWorkflowAction(caller("nobody", "w5:p5"), "ask", LAUNCH, { forkCheck, caller: { cwd: "/x" } });
      expect(elsewhere.ok ? "ok" : elsewhere.error.code).toBe("refused");
    });
  });

  test("an open gate under the launch subject allows the question", async () => {
    const { store, forkCheck, seen } = gateHarness();
    store.open({ subject: LAUNCH, kind: "plan", questions: QUESTIONS });
    expect(await authorizeWorkflowAction(caller(), "ask", LAUNCH, { forkCheck })).toEqual({ ok: true, data: undefined });
    expect(seen).toHaveLength(1);
  });

  test("an open form gate this pane asked allows the question", async () => {
    const { store, forkCheck } = gateHarness();
    store.open({ subject: "mr:x", kind: "plan", questions: QUESTIONS, origin: { presentation: "form", paneId: "w1:p1" }, nudge: { session: SID } });
    expect(await authorizeWorkflowAction(caller(SID, "w1:p1"), "ask", LAUNCH, { forkCheck })).toEqual({ ok: true, data: undefined });
  });

  test("no askable gate refuses with the gate protocol's reason, naming the subject rt gate ask would file under", async () => {
    const { store, forkCheck } = gateHarness();
    store.open({ subject: LAUNCH, kind: "pane-attention", questions: QUESTIONS });
    const res = await authorizeWorkflowAction(caller(), "ask", LAUNCH, { forkCheck });
    expect(res).toEqual({ ok: false, error: { code: "refused", message: forkDenyReason("run:r1") } });
  });

  test("another session's form gate in a reused pane refuses", async () => {
    const { store, forkCheck } = gateHarness();
    store.open({ subject: "mr:x", kind: "plan", questions: QUESTIONS, origin: { presentation: "form", paneId: "w1:p1" }, nudge: { session: "someone-else" } });
    const res = await authorizeWorkflowAction(caller("stranger", "w1:p1"), "ask", LAUNCH, { forkCheck });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("refused");
  });

  test("a fork-check with no verdict is unavailable, distinct from allow", async () => {
    const unavailable: string[] = [];
    const onUnavailable: PolicyDeps["onUnavailable"] = (_c, action) => { unavailable.push(action); };
    for (const forkCheck of [
      async () => null,
      async () => ({ ok: false as const, error: "unknown command" }),
      async () => { throw new Error("socket closed"); },
    ] satisfies PolicyDeps["forkCheck"][]) {
      const res = await authorizeWorkflowAction(caller(), "ask", LAUNCH, { forkCheck, onUnavailable });
      expect(res.ok).toBe(false);
      expect(isPolicyUnavailable(res)).toBe(true);
    }
    expect(unavailable).toEqual(["ask", "ask", "ask"]);
  });

  test("the Claude hook output is unchanged: allow on a verdict-less check, deny with the same reason", () => {
    expect(forkVerdict(null)).toEqual({ kind: "unavailable", reason: "the gate service gave no verdict" });
    expect(forkCheckHookOutput(null)).toEqual(FORK_CHECK_ALLOW);
    expect(forkCheckHookOutput({ ok: false, error: "x" })).toEqual(FORK_CHECK_ALLOW);
    expect(forkCheckHookOutput({ ok: true, data: { allow: true, match: "subject", gateId: "g" } })).toEqual(FORK_CHECK_ALLOW);
    expect(forkCheckHookOutput({ ok: true, data: { allow: false, subject: "run:r1" } })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: forkDenyReason("run:r1") },
    });
  });
});

// ─── Run mutations ───────────────────────────────────────────────────────────

describe("authorizeWorkflowAction: continue and complete refuse a foreign caller", () => {
  function realRun(session: string | null, opts: { status?: string } = {}): { root: string; runDb: string } {
    const root = join(dir, "own-runs");
    const env = session ? { CLAUDE_CODE_SESSION_ID: session } : {};
    const started = runStart(root, { repo: "repo-a", workType: "feature", pipeline: "feature", env, now: 1000 });
    if (!started.ok) throw new Error(started.error);
    if (opts.status) {
      const db = openRunDb(started.runDb);
      runStatus(db, opts.status, 2000);
      db.close();
    }
    return { root, runDb: started.runDb };
  }
  const deps = (root: string): PolicyDeps => ({ env: { RT_RUNS_ROOT: root }, onUnavailable: () => {} });

  for (const action of ["continue", "complete"] as const) {
    test(`${action}: the owning session may act on its running run`, async () => {
      const { root, runDb } = realRun(SID);
      expect(await authorizeWorkflowAction(caller(), action, runDb, deps(root))).toEqual({ ok: true, data: undefined });
    });

    test(`${action}: another session is refused`, async () => {
      const { root, runDb } = realRun("someone-else");
      const res = await authorizeWorkflowAction(caller(), action, runDb, deps(root));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("refused");
    });

    test(`${action}: a run no session owns is ambiguous, not granted`, async () => {
      const { root, runDb } = realRun(null);
      const res = await authorizeWorkflowAction(caller(), action, runDb, deps(root));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("ambiguous");
    });

    test(`${action}: an ended run is refused`, async () => {
      const { root, runDb } = realRun(SID, { status: "done" });
      const res = await authorizeWorkflowAction(caller(), action, runDb, deps(root));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("refused");
    });
  }

  test("a run store outside the runs root is invalid, through the run tools' own validator", async () => {
    const { root } = realRun(SID);
    const elsewhere = join(dir, "elsewhere", "state.db");
    mkdirSync(join(dir, "elsewhere"), { recursive: true });
    writeFileSync(elsewhere, "");
    const res = await authorizeWorkflowAction(caller(), "complete", elsewhere, deps(root));
    expect(res).toEqual({ ok: false, error: { code: "invalid", message: `runDb must be under the runs root (${root})` } });
  });

  test("a run store that cannot be read is unavailable", async () => {
    const root = join(dir, "own-runs");
    const broken = join(root, "repo-a", "r-broken", "state.db");
    mkdirSync(join(root, "repo-a", "r-broken"), { recursive: true });
    writeFileSync(broken, "not a database");
    const res = await authorizeWorkflowAction(caller(), "continue", broken, deps(root));
    expect(isPolicyUnavailable(res)).toBe(true);
  });
});

// ─── Claude policy adapter ──────────────────────────────────────────────────

describe("createClaudePolicy", () => {
  const STOP_ENTRY = { hooks: [{ type: "command", command: 'sh "${CLAUDE_PLUGIN_ROOT}/hooks/pipeline-gate-stop.sh"', timeout: 5 }] };

  function plugin(opts: { stop?: boolean; askHook?: boolean } = {}) {
    const root = join(dir, `plugin${opts.stop === false ? "-nostop" : ""}${opts.askHook ? "-ask" : ""}`);
    mkdirSync(join(root, "hooks"), { recursive: true });
    writeFileSync(join(root, "hooks", "pipeline-gate-stop.sh"), "#!/bin/sh\nexit 0\n");
    writeFileSync(join(root, "hooks", "ask.sh"), "#!/bin/sh\nexit 0\n");
    const hooks: Record<string, unknown[]> = {
      PreToolUse: [
        { matcher: "EnterWorktree", hooks: [{ type: "command", command: 'sh "${CLAUDE_PLUGIN_ROOT}/hooks/relocation-announce.sh"' }] },
        ...(opts.askHook ? [{ matcher: "AskUserQuestion", hooks: [{ type: "command", command: 'sh "${CLAUDE_PLUGIN_ROOT}/hooks/ask.sh"' }] }] : []),
      ],
      ...(opts.stop !== false && { Stop: [STOP_ENTRY] }),
    };
    writeFileSync(join(root, "hooks", "hooks.json"), JSON.stringify({ hooks }));
    const fork = join(dir, "gate-fork.sh");
    writeFileSync(fork, "#!/bin/sh\n");
    return { root, fork };
  }

  const request = (required: string[] = ["continuation-policy", "gate-policy"]) => ({
    reservationId: "res-1", cwd: "/wt/a", mode: "herdr" as const,
    selection: { harness: "claude", options: {} }, required: required as never, access: { readRoots: [] },
  });

  function adapter(p: { root: string; fork: string | null }, version = "2.1.283") {
    return createClaudePolicy({
      plugins: () => [{ id: "mattstack@mattstack", installPath: p.root, enabled: true }],
      gateForkHookPath: () => p.fork,
      claudeVersion: () => version,
      now: () => 42,
    });
  }

  test("prepare inspects the plugin's Stop hook and the gate-fork hook and verify proves them for the binding's generation", async () => {
    const p = plugin();
    const policy = adapter(p);
    const prepared = await policy.prepare(request());
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(prepared.data).toMatchObject({ harness: "claude", profile: "default", cwd: "/wt/a" });
    expect(prepared.data.revision).toMatch(/^[0-9a-f]{64}$/);
    const proof = await policy.verify(binding(), prepared.data);
    expect(proof).toEqual({
      ok: true,
      data: {
        sessionKey: `key-${SID}`, generation: 3, revision: prepared.data.revision, verified: ["continuation-policy", "gate-policy"], observedAt: 42,
        kind: "installation",
      },
    });
  });

  test("the revision covers script contents, the definitions, the gate-fork entry and the Claude Code version", async () => {
    const p = plugin();
    const base = await adapter(p).prepare(request());
    if (!base.ok) throw new Error(base.error.message);
    const rev = async (a: ReturnType<typeof adapter>) => {
      const r = await a.prepare(request());
      if (!r.ok) throw new Error(r.error.message);
      return r.data.revision;
    };
    expect(await rev(adapter(p, "2.1.290"))).not.toBe(base.data.revision);
    writeFileSync(join(p.root, "hooks", "pipeline-gate-stop.sh"), "#!/bin/sh\nexit 1\n");
    expect(await rev(adapter(p))).not.toBe(base.data.revision);
    writeFileSync(join(p.root, "hooks", "pipeline-gate-stop.sh"), "#!/bin/sh\nexit 0\n");
    expect(await rev(adapter(p))).toBe(base.data.revision);
    writeFileSync(p.fork, "#!/bin/sh\n# changed\n");
    expect(await rev(adapter(p))).not.toBe(base.data.revision);
    const withAsk = plugin({ askHook: true });
    expect(await rev(adapter(withAsk))).not.toBe(base.data.revision);
    expect(gateForkHookEntry(p.fork).matcher).toBe("AskUserQuestion");
  });

  test("a hook changed between prepare and verify gives no proof", async () => {
    const p = plugin();
    const policy = adapter(p);
    const prepared = await policy.prepare(request());
    if (!prepared.ok) throw new Error(prepared.error.message);
    writeFileSync(join(p.root, "hooks", "pipeline-gate-stop.sh"), "#!/bin/sh\nexit 1\n");
    const proof = await policy.verify(binding(), prepared.data);
    expect(proof.ok).toBe(false);
    if (!proof.ok) expect(proof.error.code).toBe("not-ready");
  });

  test("a missing or disabled plugin, a missing Stop hook, or a missing gate-fork hook is not ready for what it lacks", async () => {
    const p = plugin();
    const none = createClaudePolicy({ plugins: () => [], gateForkHookPath: () => p.fork, claudeVersion: () => "2.1.283" });
    expect((await none.prepare(request())).ok).toBe(false);
    const disabled = createClaudePolicy({
      plugins: () => [{ id: "mattstack@mattstack", installPath: p.root, enabled: false }],
      gateForkHookPath: () => p.fork, claudeVersion: () => "2.1.283",
    });
    expect((await disabled.prepare(request())).ok).toBe(false);

    const noStop = plugin({ stop: false });
    const stopless = await adapter(noStop).prepare(request(["continuation-policy"]));
    expect(stopless.ok ? "ok" : stopless.error.code).toBe("not-ready");
    expect((await adapter(noStop).prepare(request(["gate-policy"]))).ok).toBe(true);

    const forkless = await adapter({ root: p.root, fork: null }).prepare(request(["gate-policy"]));
    expect(forkless.ok ? "ok" : forkless.error.code).toBe("not-ready");
    expect((await adapter({ root: p.root, fork: null }).prepare(request(["continuation-policy"]))).ok).toBe(true);
  });

  test("a Stop script the definition names but that is missing is not ready", async () => {
    const p = plugin();
    rmSync(join(p.root, "hooks", "pipeline-gate-stop.sh"));
    const res = await adapter(p).prepare(request(["continuation-policy"]));
    expect(res.ok ? "ok" : res.error.code).toBe("not-ready");
    expect(existsSync(join(p.root, "hooks", "hooks.json"))).toBe(true);
  });

  test("a failed version probe is not ready and says so, never a revision that looks like changed hooks", async () => {
    const p = plugin();
    const res = await createClaudePolicy({
      plugins: () => [{ id: "mattstack@mattstack", installPath: p.root, enabled: true }],
      gateForkHookPath: () => p.fork, claudeVersion: () => null,
    }).prepare(request());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("not-ready");
      expect(res.error.message).toContain("claude --version");
    }
  });

  test("a session whose live mod link carries both blocks proves gate policy through the mod, and continuation policy only beside the installed shell Stop hook", async () => {
    const withMod = (p: { root: string; fork: string | null }, live: boolean) => createClaudePolicy({
      plugins: () => [{ id: "mattstack@mattstack", installPath: p.root, enabled: true }],
      gateForkHookPath: () => p.fork, claudeVersion: () => "2.1.283", now: () => 42, modPolicy: () => live,
    });
    const full = plugin();
    const stopless = plugin({ stop: false });
    const cases = [
      // No launch gate-fork hook: the mod's guard supplies gate policy, the shell Stop hook continuation.
      { p: { root: full.root, fork: null }, required: ["continuation-policy"], live: true, verified: ["gate-policy", "continuation-policy"] },
      { p: { root: full.root, fork: null }, required: ["continuation-policy"], live: false, verified: ["continuation-policy"] },
      // No shell Stop hook: the mod's stop gate has no backstop, so continuation policy is not proved.
      { p: stopless, required: ["gate-policy"], live: true, verified: ["gate-policy"] },
      { p: stopless, required: ["gate-policy"], live: false, verified: ["gate-policy"] },
    ];
    for (const c of cases) {
      const policy = withMod(c.p, c.live);
      const prepared = await policy.prepare(request(c.required));
      if (!prepared.ok) throw new Error(prepared.error.message);
      const proof = await policy.verify(binding(), prepared.data);
      expect(proof.ok ? proof.data.verified : proof.error.message).toEqual(c.verified as Capability[]);
    }
  });

  test("the mod evidence is the binding's own live link with both blocks", () => {
    const db = openStateDb(":memory:");
    const links = createModLinks({ now: () => 5_000, integrationsEnabled: () => true, store: createSessionStore(db) });
    const reg = (sessionId: string, blocks: ModBlock[]) =>
      links.register({ sessionId, cwd: "/r", root: "/r", claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.2.1", blocks });
    reg(SID, ["policy", "stop-gate"]);
    reg("guard-only", ["policy"]);
    expect(sessionModPolicy(binding(), links)).toEqual(["gate-policy", "continuation-policy"]);
    expect(sessionModPolicy(binding("guard-only"), links)).toEqual([]);
    expect(sessionModPolicy(binding("no-link"), links)).toEqual([]);
    expect(sessionModPolicy(binding(SID, "w1:p1", "codex"), links)).toEqual([]);
    expect(sessionModPolicy(binding(), null)).toEqual([]);
  });

  test("verify refuses a binding of another harness", async () => {
    const p = plugin();
    const policy = adapter(p);
    const prepared = await policy.prepare(request());
    if (!prepared.ok) throw new Error(prepared.error.message);
    const res = await policy.verify(binding(SID, "w1:p1", "codex"), prepared.data);
    expect(res.ok ? "ok" : res.error.code).toBe("invalid");
  });
});
