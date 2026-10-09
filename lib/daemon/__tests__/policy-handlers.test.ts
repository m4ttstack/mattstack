import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type { ModBlock, SessionBinding } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createModLinks, TESTED_CLAUDE_CODE, type ModLinks } from "../../agent-integrations/claude/mod-links.ts";
import { attachedClaudeBinding } from "../../agent-integrations/claude/sessions.ts";
import { forkDenyReason, stopReason, type PolicyDeps } from "../../agent-integrations/policy.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { runStart } from "../../runs/start.ts";
import { openRunDb, stageStart } from "../../runs/write.ts";
import { openStateDb } from "../../state/db.ts";
import type { EventsBus } from "../events-bus.ts";
import { createGatesStore } from "../gates-store.ts";
import { createGateHandlers } from "../handlers/gate.ts";
import { createPolicyHandlers } from "../handlers/policy.ts";

const SID = "11111111-2222-3333-4444-555555555555";
const PANE = "w1:p1";
const LAUNCH = "herd:acme-x/acme-1234-attorney";
const QUESTIONS = [{ id: "q1", label: "go?", multi: false, options: ["yes", "no"] }];

let dir = "";
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-policy-handlers-"))); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

type Reply = { ok: boolean; data?: any; error?: string; failure?: { code: string; message: string } };
const call = (fn: (payload: never) => Promise<unknown>, payload: unknown) => fn(payload as never) as Promise<Reply>;

function bind(db: Database, session = SID): SessionBinding {
  const store = createSessionStore(db);
  const bound = store.bind(store.reserve({ identity: "id-1" }), { harness: "claude", profile: "default", kind: "id", value: session }, { mode: "herdr", pane: PANE });
  if (!bound.ok) throw new Error(bound.error.message);
  return bound.data;
}

type StopRun = { id: string; held?: "hold" | "waiting-gate" };

/** One state.db behind the link registry and the bindings; a real gate store behind the fork-check; runs read from `runs`. */
function setup(opts: { blocks?: ModBlock[]; bound?: boolean; subject?: string; runs?: StopRun[]; policy?: PolicyDeps; noVerdict?: boolean; previous?: string } = {}) {
  const db = openStateDb(":memory:");
  const links: ModLinks = createModLinks({ now: () => 5_000, integrationsEnabled: () => true, store: createSessionStore(db) });
  const link = (sessionId: string, previous?: { sessionId: string; linkId: string }) => links.register({
    sessionId, cwd: dir, root: dir, pane: PANE, claudeCode: TESTED_CLAUDE_CODE.max, plugin: "0.2.2",
    blocks: opts.blocks ?? ["policy", "stop-gate"],
    ...(previous && { previousSessionId: previous.sessionId, previousLinkId: previous.linkId }),
  });
  let continued: { sessionId: string; linkId: string } | undefined;
  if (opts.previous !== undefined) {
    // The session started as `previous`, and a /clear its link reported continued it as SID.
    if (opts.bound !== false) bind(db, opts.previous);
    const first = link(opts.previous);
    if (!first.ok) throw new Error(first.error.message);
    continued = { sessionId: opts.previous, linkId: first.data.linkId };
  } else if (opts.bound !== false) bind(db);
  const registered = link(SID, continued);
  if (!registered.ok) throw new Error(registered.error.message);
  const linkId = registered.data.linkId;

  const gates = createGatesStore({ dbPath: join(dir, "gates.db"), log: pino({ level: "silent" }) });
  let nextId = 1;
  const gateHandlers = createGateHandlers(gates, { emitAt: () => nextId++ } as unknown as EventsBus, () => {}, {
    resolveSubject: ({ sessionId }) => (sessionId === SID ? { ok: true, subject: "run:r1", runId: "r1" } : { ok: false, error: "no subject" }),
  });
  const forkChecks: unknown[] = [];
  const unavailable: string[] = [];
  const runs = { list: opts.runs ?? [] };
  const handlers = createPolicyHandlers({
    links, db, runsRoot: join(dir, "runs"),
    forkCheck: async (payload) => {
      forkChecks.push(payload);
      return opts.noVerdict ? null : gateHandlers["gate:fork-check"](payload);
    },
    subjectOf: () => ("subject" in opts ? opts.subject : LAUNCH),
    policy: {
      findRunning: () => runs.list.map((r) => r.id),
      snapshot: (id) => {
        const run = runs.list.find((r) => r.id === id)!;
        return {
          ok: true,
          run: { id: run.id, status: "running", current_stage: "ship", started_at: 1000 },
          stages: [{ name: "ship", started_at: 2000 }],
          fields: [
            { key: "claude-session", value: SID, at: 1000 },
            ...(run.held ? [{ key: run.held, value: "parked", at: 3000 }] : []),
          ],
        };
      },
      onUnavailable: (_context, action) => { unavailable.push(action); },
      ...opts.policy,
    },
  });
  return { db, links, linkId, gates, handlers, forkChecks, unavailable, runs };
}

describe("policy:authorize", () => {
  test("mod guard refuses a foreign gate answer with its reason", async () => {
    const { gates, handlers, linkId } = setup();
    // Another session's form gate, asked in this reused pane: answering it here is not this session's to do.
    gates.open({ subject: "mr:x", kind: "plan", questions: QUESTIONS, origin: { presentation: "form", paneId: PANE }, nudge: { session: "someone-else" } });
    expect(await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask" }))
      .toEqual({ ok: true, data: { decision: "refuse", reason: forkDenyReason("run:r1") } });
  });

  test("the session's own open gate allows its question", async () => {
    const { gates, handlers, linkId } = setup();
    gates.open({ subject: LAUNCH, kind: "plan", questions: QUESTIONS });
    expect(await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask" })).toEqual({ ok: true, data: { decision: "allow" } });
  });

  test("the caller comes from the live link: its session and pane, never an id, pane or subject the payload names; its cwd only adds a worktree", async () => {
    const { handlers, linkId, forkChecks } = setup();
    await call(handlers["policy:authorize"], {
      linkId, sessionId: SID, action: "ask", subject: "run:someone-elses", cwd: "/elsewhere", sessionIds: ["sess-other"], paneId: "w9:p9",
    });
    expect(forkChecks).toEqual([{ subject: LAUNCH, sessionIds: [SID], paneId: PANE, worktrees: [dir, "/elsewhere"] }]);
  });

  test("after EnterWorktree, the session's current directory finds the run gate filed from that worktree", async () => {
    const { gates, handlers, linkId } = setup();
    const tree = join(dir, ".wt", "x");
    gates.open({ subject: "run:r9", kind: "plan", questions: QUESTIONS, origin: { worktree: tree } });
    // The link registered at the repo root; only the question's own directory matches the gate.
    expect((await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask" })).data.decision).toBe("refuse");
    expect(await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask", cwd: tree })).toEqual({ ok: true, data: { decision: "allow" } });
    expect((await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask", cwd: "/nowhere/else" })).data.decision).toBe("refuse");
  });

  test("a cwd must be an absolute path with no control characters", async () => {
    const { handlers, linkId } = setup();
    for (const cwd of ["relative/dir", "", "/repo\n/x", "/repo\u0000", 7]) {
      expect((await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask", cwd })).failure?.code).toBe("invalid");
    }
  });

  test("after a /clear continuation, the form gate the session asked under its earlier id still allows its question", async () => {
    const { gates, handlers, linkId, forkChecks } = setup({ previous: "sess-before-clear" });
    gates.open({ subject: "mr:x", kind: "plan", questions: QUESTIONS, origin: { presentation: "form", paneId: PANE }, nudge: { session: "sess-before-clear" } });
    expect(await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask" })).toEqual({ ok: true, data: { decision: "allow" } });
    expect(forkChecks).toEqual([expect.objectContaining({ sessionIds: [SID, "sess-before-clear"] })]);
  });

  test("a launch with no gate subject asks nothing and allows", async () => {
    const { handlers, linkId, forkChecks } = setup({ subject: undefined });
    expect(await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask" })).toEqual({ ok: true, data: { decision: "allow" } });
    expect(forkChecks).toHaveLength(0);
  });

  test("continue and complete: the owning session may move its run, another session's run is refused", async () => {
    const root = join(dir, "runs");
    const run = (session: string) => {
      const started = runStart(root, { repo: "repo-a", workType: "feature", pipeline: "feature", env: { CLAUDE_CODE_SESSION_ID: session }, now: 1000 });
      if (!started.ok) throw new Error(started.error);
      return started.runDb;
    };
    // The real run store readers, over real runs.
    const { db, handlers, linkId } = setup({ policy: { env: { RT_RUNS_ROOT: root }, findRunning: undefined, snapshot: undefined } });
    const own = run(SID);
    const unproven = run("someone-else");
    const other = bind(db, "sess-bound-elsewhere");
    const started = runStart(root, { repo: "repo-a", workType: "feature", pipeline: "feature", env: {}, now: 1000, binding: other });
    if (!started.ok) throw new Error(started.error);
    for (const action of ["continue", "complete"]) {
      expect(await call(handlers["policy:authorize"], { linkId, sessionId: SID, action, subject: own })).toEqual({ ok: true, data: { decision: "allow" } });
      const foreign = await call(handlers["policy:authorize"], { linkId, sessionId: SID, action, subject: started.runDb });
      expect(foreign.data).toEqual({ decision: "refuse", reason: expect.stringContaining("belongs to another session") });
      const refused = await call(handlers["policy:authorize"], { linkId, sessionId: SID, action, subject: unproven });
      expect(refused.data).toEqual({ decision: "refuse", reason: expect.stringContaining("ownership cannot be proven") });
    }
  });

  test("a fork-check with no verdict is unavailable, never allow, and records the session as unready", async () => {
    const { handlers, linkId, unavailable } = setup({ noVerdict: true });
    const reply = await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask" });
    expect(reply.ok).toBe(false);
    expect(reply.failure?.code).toBe("transient");
    expect(unavailable).toEqual(["ask"]);
  });

  test("validates its payload", async () => {
    const { handlers, linkId } = setup();
    for (const bad of [
      undefined, {}, { linkId, action: "ask" }, { linkId, sessionId: "", action: "ask" }, { linkId, sessionId: SID, action: "answer" },
      { linkId, sessionId: SID, action: "continue" }, { linkId, sessionId: SID, action: "complete", subject: "" }, { sessionId: SID, action: "ask" },
    ]) {
      expect((await call(handlers["policy:authorize"], bad)).failure?.code).toBe("invalid");
    }
    // A malformed payload reports its first missing field, before the action is read.
    expect((await call(handlers["policy:authorize"], { action: "answer" })).failure?.message).toBe("linkId must be a non-empty string");
    expect((await call(handlers["policy:authorize"], { linkId, action: "answer" })).failure?.message).toBe("sessionId must be a non-empty string");
  });
});

describe("policy:authorize and policy:stop resolve the caller from the live link only", () => {
  test("an unknown link re-registers, another session's link is refused, a block not live decides nothing", async () => {
    const { handlers, linkId } = setup({ blocks: ["delivery"] });
    for (const verb of ["policy:authorize", "policy:stop"] as const) {
      const payload = verb === "policy:stop" ? {} : { action: "ask" };
      expect((await call(handlers[verb], { ...payload, linkId: "ml-missing", sessionId: SID })).failure?.code).toBe("unknown-link");
      expect((await call(handlers[verb], { ...payload, linkId, sessionId: "sess-other" })).failure?.code).toBe("refused");
      expect((await call(handlers[verb], { ...payload, linkId, sessionId: SID })).failure?.code).toBe("refused");
    }
  });

  test("an unbound session gets no decision, so the mod passes and the shell hooks decide", async () => {
    const { handlers, linkId, forkChecks } = setup({ bound: false, runs: [{ id: "r-open" }] });
    expect(await call(handlers["policy:authorize"], { linkId, sessionId: SID, action: "ask" }))
      .toEqual({ ok: true, data: { decision: "none", reason: expect.any(String) } });
    expect(await call(handlers["policy:stop"], { linkId, sessionId: SID }))
      .toEqual({ ok: true, data: { decision: "none", reason: expect.any(String) } });
    expect(forkChecks).toHaveLength(0);
  });
});

describe("policy:stop", () => {
  test("mod stop blocks an open running stage and allows a held or waiting one", async () => {
    const { handlers, linkId, runs } = setup({ runs: [{ id: "r-open" }] });
    expect(await call(handlers["policy:stop"], { linkId, sessionId: SID }))
      .toEqual({ ok: true, data: { decision: "continue", runId: "r-open", stage: "ship", reason: stopReason("r-open", "ship") } });
    for (const held of ["hold", "waiting-gate"] as const) {
      runs.list = [{ id: "r-open", held }];
      expect(await call(handlers["policy:stop"], { linkId, sessionId: SID })).toEqual({ ok: true, data: { decision: "allow" } });
    }
  });

  test("a second stop shortly after a first is evaluated afresh", async () => {
    const { handlers, linkId, runs } = setup({ runs: [{ id: "r-open" }] });
    expect((await call(handlers["policy:stop"], { linkId, sessionId: SID })).data.decision).toBe("continue");
    runs.list = [{ id: "r-open", held: "hold" }];
    expect((await call(handlers["policy:stop"], { linkId, sessionId: SID })).data.decision).toBe("allow");
    runs.list = [{ id: "r-open" }];
    expect((await call(handlers["policy:stop"], { linkId, sessionId: SID })).data.decision).toBe("continue");
  });

  test("runs that cannot be read are unavailable, never allow, and record the session as unready", async () => {
    const { handlers, linkId, unavailable } = setup({ policy: { findRunning: () => { throw new Error("runs root unreadable"); } } });
    const reply = await call(handlers["policy:stop"], { linkId, sessionId: SID });
    expect(reply.ok).toBe(false);
    expect(reply.failure).toEqual({ code: "transient", message: expect.stringContaining("runs root unreadable") });
    expect(unavailable).toEqual(["stop"]);
  });

  test("validates its payload", async () => {
    const { handlers, linkId } = setup();
    for (const bad of [undefined, {}, { linkId }, { linkId, sessionId: "" }, { sessionId: SID }]) {
      expect((await call(handlers["policy:stop"], bad)).failure?.code).toBe("invalid");
    }
  });
});

describe("runs:owned", () => {
  /** A running run in `tree` with an open stage, owned by `owner` (a binding, or a bare Claude session id as a legacy run records). */
  function ownedRun(runId: string, tree: string, owner: SessionBinding | string): string {
    const root = join(dir, "runs");
    const started = typeof owner === "string"
      ? runStart(root, { repo: "repo-a", workType: "feature", pipeline: "feature", runId, env: { CLAUDE_CODE_SESSION_ID: owner }, now: 1000 })
      : runStart(root, { repo: "repo-a", workType: "feature", pipeline: "feature", runId, env: {}, now: 1000, binding: owner });
    if (!started.ok) throw new Error(started.error);
    const run = openRunDb(started.runDb);
    run.run("INSERT INTO fields (run_id, key, value, produced_by, at) SELECT id, 'worktree', ?, 'provision', 1000 FROM runs", [tree]);
    stageStart(run, "implement", {}, 2000);
    run.close();
    return started.runDb;
  }

  test("run_* without runDb resolves the owned run", async () => {
    const { db, handlers, linkId } = setup();
    const own = ownedRun("r-own", join(dir, "tree-a"), attachedClaudeBinding(db, SID)!);
    expect(await call(handlers["runs:owned"], { linkId, sessionId: SID })).toEqual({ ok: true, data: { runDb: own } });

    // Two owned runs: the session's current directory picks, and with neither holding it nothing is named.
    const second = ownedRun("r-own-2", join(dir, "tree-b"), attachedClaudeBinding(db, SID)!);
    expect(await call(handlers["runs:owned"], { linkId, sessionId: SID, cwd: join(dir, "tree-b", "src") })).toEqual({ ok: true, data: { runDb: second } });
    expect(await call(handlers["runs:owned"], { linkId, sessionId: SID, cwd: "/nowhere" }))
      .toEqual({ ok: true, data: { runDb: null, reason: expect.stringContaining("more than one running run") } });
  });

  test("a legacy run recorded under the session's own id is its owned run", async () => {
    const { handlers, linkId } = setup();
    const legacy = ownedRun("r-legacy", join(dir, "tree"), SID);
    expect(await call(handlers["runs:owned"], { linkId, sessionId: SID })).toEqual({ ok: true, data: { runDb: legacy } });
  });

  test("a foreign run is never filled", async () => {
    const { db, handlers, linkId } = setup();
    const tree = join(dir, "tree");
    ownedRun("r-foreign", tree, bind(db, "sess-other"));
    ownedRun("r-unproven", tree, "sess-nobody");
    // Both runs sit in the session's own directory; one belongs to another session, the other to one nobody can prove.
    expect(await call(handlers["runs:owned"], { linkId, sessionId: SID, cwd: tree }))
      .toEqual({ ok: true, data: { runDb: null, reason: expect.stringContaining("no running run belongs to this session") } });
  });

  test("the caller comes from the live link only: the payload's session selects nothing the link does not prove", async () => {
    const { db, handlers, linkId } = setup({ blocks: ["policy"] });
    ownedRun("r-other", join(dir, "tree"), bind(db, "sess-other"));
    expect((await call(handlers["runs:owned"], { linkId, sessionId: "sess-other" })).failure?.code).toBe("refused");
    expect((await call(handlers["runs:owned"], { linkId: "ml-missing", sessionId: "sess-other" })).failure?.code).toBe("unknown-link");

    const noBlock = setup({ blocks: ["stop-gate"] });
    expect((await call(noBlock.handlers["runs:owned"], { linkId: noBlock.linkId, sessionId: SID })).failure?.code).toBe("refused");

    const unbound = setup({ bound: false });
    expect(await call(unbound.handlers["runs:owned"], { linkId: unbound.linkId, sessionId: SID }))
      .toEqual({ ok: true, data: { runDb: null, reason: expect.any(String) } });
  });

  test("validates its payload", async () => {
    const { handlers, linkId } = setup();
    for (const bad of [undefined, {}, { linkId }, { linkId, sessionId: "" }, { sessionId: SID }, { linkId, sessionId: SID, cwd: "relative" }]) {
      expect((await call(handlers["runs:owned"], bad)).failure?.code).toBe("invalid");
    }
  });
});
