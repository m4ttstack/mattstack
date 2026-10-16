import { describe, expect, test } from "bun:test";
import type { GateAnswer, GateRow } from "../../../packages/rt-client/src/index.ts";
import { executeRespondPost, mrCompositeToolDefs, type MrCompositeDeps, type RespondPostResult, type RunSnapshot, type SnapshotField } from "../mr-composite-tools.ts";
import type { ToolResult } from "../shared.ts";

type Q = { id: string; label: string; multi: boolean; context?: Record<string, unknown>; options: unknown[] };
type Source = { context: Record<string, unknown>; questions: Q[] };

const T1_FIXED = "Fixed -- queue/enqueue.ts:88 / enqueue() now drops non-retryable jobs; added the check and a test.";
const T2_VERBATIM = "the wait is a fixed 30s delay (queue/retry.ts:14), so the README keeps delay.";
const T2_OVERRIDE = "kept delay: the wait is fixed.";

function planThread(n: number, id: string, reply: { kind: string; text?: string }): Q {
  return {
    id: `thread-${n}`, label: `queue/file-${n}.ts:${n}`, multi: false,
    context: { "gate-ctx": "thread@1", author: "renee", claim: { summary: `ask ${id}` }, reply },
    options: [{ value: `reply:${id}`, label: "reply" }, { value: `fix:${id}`, label: "fix" }, { value: `skip:${id}`, label: "skip" }],
  };
}
const planSource = (threads: Q[]): Source => ({
  context: { "gate-ctx": "plan@1", reviewer: "renee" },
  questions: [...threads, { id: "code-changes", label: "Approve?", multi: false, options: ["approve", "revise", "skip"] }],
});
function postThread(n: number, id: string, verb: "fix" | "reply", text: string): Q {
  return {
    id: `thread-${n}`, label: `queue/file-${n}.ts:${n}`, multi: true,
    context: { "gate-ctx": "reply@1", thread: id, verb, text },
    options: [{ value: `post:${id}`, label: "post" }, { value: `resolve:${id}`, label: "resolve" }],
  };
}
const postSource = (threads: Q[]): Source => ({
  context: { "gate-ctx": "post@1", reviewer: "renee" },
  questions: [...threads, { id: "next", label: "Next", multi: false, options: ["proceed", "iterate", "hold"] }],
});

const PLAN = planSource([planThread(1, "T1", { kind: "direction", text: "fix it" }), planThread(2, "T2", { kind: "verbatim", text: T2_VERBATIM })]);
const POST_T1 = postSource([postThread(1, "T1", "fix", T1_FIXED)]);
const POST_T1_T2 = postSource([postThread(1, "T1", "fix", T1_FIXED), postThread(2, "T2", "reply", T2_OVERRIDE)]);

const MR = "https://gitlab.com/acme/acme-dev/-/merge_requests/7";
const ID = "remote:gitlab.com%2Facme%2Facme-dev";
const STARTED = Date.parse("2026-10-16T10:00:00Z");
const ENV = {} as NodeJS.ProcessEnv;
const RUN_DB = "/runs/r1/state.db";

const field = (key: string, value: string, at: number): SnapshotField => ({ run_id: "r1", key, value, produced_by: "respond", at });
const sourceField = (scope: string, gate: string | null, source: Source, at: number) => field(`extra.gate-source.${scope}`, JSON.stringify({ gate, source }), at);
const decision = (scope: string, selection: unknown, decidedAt: number) => ({
  run_id: "r1", contract: "gate@1", scope, selection: JSON.stringify(selection), decided_by: "matt", decided_at: decidedAt,
});

function row(id: string, source: Source, answers: Record<string, unknown>, openedAt: number): GateRow {
  return {
    id, subject: `run:r1/${id}`, kind: "respond", meta: null, context: JSON.stringify(source.context), origin: null,
    questions: source.questions.map((q) => ({
      id: q.id, label: q.label, multi: q.multi,
      options: q.options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: (o as { value: string }).value, label: (o as { label: string }).label })),
      ...(q.context && { context: JSON.stringify(q.context) }),
    })),
    status: "answered", answer: { answers: answers as GateAnswer["answers"], by: "matt", answeredAt: openedAt + 500 },
    openedAt, parkedAt: null, closedAt: null, closedReason: null, supersededBy: null, agent: null, pane: null, nudge: null,
    delivery: null, released: false, consumedAt: null, owner: null, escalatedAt: null,
  };
}

type Reply = { ok: boolean; data?: unknown; error?: string };
type GitReply = { code: number; stdout: string; stderr: string };
type Call = { kind: "cmd" | "run" | "git"; name: string; payload: Record<string, unknown> | string[] };

const T_PRE = "2026-10-16T09:00:00Z";
const T_POST = "2026-10-16T11:00:00Z";

function note(id: number, body: string, by = "renee", at = T_PRE) {
  return { id, body, author: { username: by }, createdAt: at, system: false, type: null, resolvable: true, resolved: false, position: null };
}
function disc(id: string, notes: ReturnType<typeof note>[], resolved = false) {
  return { id, resolvable: true, resolved, notes };
}
const fresh = () => [disc("T1", [note(1, "please drop non-retryable jobs")]), disc("T2", [note(2, "why delay?")])];

type World = {
  snapshot: RunSnapshot;
  gates: Record<string, Reply>;
  cmd: Record<string, Reply[]>;
  git: Record<string, GitReply | GitReply[]>;
  pushes: GitReply[];
  tree: string;
  runFail?: Record<string, string>;
};

const okData = (data: unknown): Reply => ({ ok: true, data });
const fail = (error: string): Reply => ({ ok: false, error });
const gitOk = (stdout: string): GitReply => ({ code: 0, stdout, stderr: "" });
const gitFail = (stderr: string, code = 1): GitReply => ({ code, stdout: "", stderr });

function world(): World {
  return {
    snapshot: {
      ok: true,
      run: { id: "r1", started_at: STARTED },
      stages: [],
      fields: [
        field("mr", MR, 50),
        field("branch", "feat-x", 50),
        sourceField("respond-plan", "g-plan", PLAN, 1_000),
        sourceField("respond-post", "g-post", POST_T1, 3_000),
      ],
      decisions: [
        decision("respond-plan", { threads: { T1: "fix", T2: "reply" }, "code-changes": "approve" }, 2_000),
        decision("respond-post", { threads: { T1: { post: true, resolve: true } } }, 4_000),
      ],
    },
    gates: {
      "g-plan": okData({ status: "answered", row: row("g-plan", PLAN, { "thread-1": "fix:T1", "thread-2": "reply:T2", "code-changes": "approve" }, 1_000) }),
      "g-post": okData({ status: "answered", row: row("g-post", POST_T1, { "thread-1": ["post:T1", "resolve:T1"], next: "proceed" }, 3_000) }),
    },
    cmd: {
      "discussions:refresh": [okData({ discussions: fresh(), fetchedAt: 1 })],
      "forge:get": [okData({ status: 200, body: { username: "me-bot" } })],
      "mr:get": [okData({ mr: { sourceBranch: "feat-x" } })],
      "discussions:reply": [okData({ discussions: [], fetchedAt: 1, noteId: 900 })],
      "discussions:resolve": [okData({ discussions: [], fetchedAt: 1 })],
    },
    git: {
      "symbolic-ref --quiet HEAD": gitOk("refs/heads/feat-x\n"),
      "rev-parse --abbrev-ref @{push}": gitOk("origin/feat-x\n"),
      "symbolic-ref --quiet refs/remotes/origin/HEAD": gitOk("refs/remotes/origin/main\n"),
      "ls-remote --symref --end-of-options origin HEAD": gitOk("ref: refs/heads/main\tHEAD\n"),
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": gitOk("origin/feat-x\n"),
    },
    pushes: [gitOk("")],
    tree: "/w",
  };
}

function noFixRow(w: World) {
  w.snapshot.fields = w.snapshot.fields.filter((f) => f.key !== "extra.gate-source.respond-post");
  w.snapshot.decisions = [decision("respond-plan", { threads: { T1: "skip", T2: "reply" }, "code-changes": "skip" }, 2_000)];
  w.gates["g-plan"] = okData({ status: "answered", row: row("g-plan", PLAN, { "thread-1": "skip:T1", "thread-2": "reply:T2", "code-changes": "skip" }, 1_000) });
  delete w.gates["g-post"];
}

function offerBoth(w: World, held?: string[]) {
  w.snapshot.fields = w.snapshot.fields.map((f) => (f.key === "extra.gate-source.respond-post" ? sourceField("respond-post", "g-post", POST_T1_T2, 3_000) : f));
  w.snapshot.decisions = [
    decision("respond-plan", { threads: { T1: "fix", T2: "reply" }, overrides: ["T2"], "code-changes": "approve" }, 2_000),
    decision("respond-post", { threads: { T1: { post: true, resolve: true }, T2: { post: true, resolve: true } }, ...(held && { held }) }, 4_000),
  ];
  w.gates["g-post"] = okData({ status: "answered", row: row("g-post", POST_T1_T2, { "thread-1": ["post:T1", "resolve:T1"], "thread-2": ["post:T2", "resolve:T2"], next: "proceed" }, 3_000) });
}

function fake(w: World): { deps: MrCompositeDeps; calls: Call[]; progress: number[] } {
  const calls: Call[] = [];
  const progress = [0];
  const queues: Record<string, Reply[]> = Object.fromEntries(Object.entries(w.cmd).map(([k, v]) => [k, [...v]]));
  const pushes = [...w.pushes];
  const gitQueues: Record<string, GitReply[]> = Object.fromEntries(Object.entries(w.git).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const deps: MrCompositeDeps = {
    command: (async (name: string, payload: Record<string, unknown>) => {
      calls.push({ kind: "cmd", name, payload });
      if (name === "gate:wait") return w.gates[payload.id as string] ?? fail(`no gate ${String(payload.id)}`);
      const q = queues[name];
      if (!q || q.length === 0) throw new Error(`unscripted command ${name}`);
      return q.length > 1 ? q.shift()! : q[0]!;
    }) as MrCompositeDeps["command"],
    readMrCache: (async () => { throw new Error("unexpected cache read"); }) as unknown as MrCompositeDeps["readMrCache"],
    async runTool(name, input) {
      calls.push({ kind: "run", name, payload: input });
      if (name === "run_snapshot") return { ok: true, body: w.snapshot };
      const failure = w.runFail?.[name];
      if (failure !== undefined) return { ok: false, body: undefined, error: failure };
      return { ok: true, body: { ok: true } };
    },
    async git(args, cwd) {
      calls.push({ kind: "git", name: args.join(" "), payload: [cwd, ...args] });
      if (args[0] === "push") {
        const r = pushes.length > 1 ? pushes.shift()! : pushes[0]!;
        return r;
      }
      const q = gitQueues[args.join(" ")];
      if (!q || q.length === 0) throw new Error(`unscripted git ${args.join(" ")}`);
      return q.length > 1 ? q.shift()! : q[0]!;
    },
    guard: { repoIndex: () => ({ [ID]: "/w" }), treeByPath: () => null, realpath: (p) => p, worktreeRoots: () => [] },
    status: async () => { throw new Error("unexpected status"); },
    sleep: async () => {},
    resolveMr: async (input) => {
      if (input.mrUrl !== MR) return { ok: false, error: `unexpected mrUrl ${String(input.mrUrl)}` };
      return { ok: true, identity: ID, iid: 7 };
    },
  };
  return { deps, calls, progress };
}

const STAGE = "respond";

/** Every pass must leave the hold seam alone: no hold:<stage> decision, never a cleared hold. */
function assertHoldRules(calls: Call[]) {
  for (const c of calls) {
    if (c.kind !== "run") continue;
    const p = c.payload as Record<string, unknown>;
    if (c.name === "run_decision") expect(String(p.scope)).not.toMatch(/^hold/);
    if (c.name === "run_field_set" && p.key === "hold") expect(p.value).toBe("held");
  }
}

async function run(w: World) {
  const f = fake(w);
  let ticks = 0;
  const r: ToolResult = await executeRespondPost(f.deps, { runDb: RUN_DB, tree: w.tree, stage: STAGE }, ENV, () => { ticks++; });
  assertHoldRules(f.calls);
  return { r, calls: f.calls, ticks };
}
async function done(w: World) {
  const out = await run(w);
  if (!out.r.ok) throw new Error(`expected a result, got: ${out.r.error}`);
  return { ...out, res: out.r.body as RespondPostResult };
}
async function refused(w: World) {
  const out = await run(w);
  if (out.r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(out.r.body)}`);
  return { ...out, error: out.r.error! };
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);
const cmdCalls = (calls: Call[], name: string) => calls.filter((c) => c.kind === "cmd" && c.name === name);
const gitCalls = (calls: Call[]) => calls.filter((c) => c.kind === "git");
const pushCalls = (calls: Call[]) => gitCalls(calls).filter((c) => c.name.startsWith("push"));
const outward = (calls: Call[]) => calls.filter((c) => c.kind === "git" || (c.kind === "cmd" && c.name !== "gate:wait") || (c.kind === "run" && c.name !== "run_snapshot"));

describe("reading", () => {
  test("it reads run_snapshot, then gate:wait with waitMs 0 for each gate id", async () => {
    const { calls } = await done(world());
    expect(calls[0]).toEqual({ kind: "run", name: "run_snapshot", payload: { runDb: RUN_DB } });
    expect(cmdCalls(calls, "gate:wait").map((c) => c.payload)).toEqual([{ id: "g-plan", waitMs: 0 }, { id: "g-post", waitMs: 0 }]);
  });

  test("a hand-back source has no gate to read", async () => {
    const w = world();
    noFixRow(w);
    w.snapshot.fields = w.snapshot.fields.map((f) => (f.key === "extra.gate-source.respond-plan" ? sourceField("respond-plan", null, PLAN, 1_000) : f));
    const { calls } = await done(w);
    expect(cmdCalls(calls, "gate:wait")).toEqual([]);
  });

  test("a respond-post source older than the plan decision is not read, so reply rows still post", async () => {
    const w = world();
    noFixRow(w);
    w.snapshot.fields.push(sourceField("respond-post", "g-old", POST_T1, 1_500));
    const { res, calls } = await done(w);
    expect(cmdCalls(calls, "gate:wait").map((c) => (c.payload as Record<string, unknown>).id)).toEqual(["g-plan"]);
    expect(res.posted).toEqual(["T2"]);
  });

  test("a gate still open refuses before anything moves", async () => {
    const w = world();
    w.gates["g-post"] = okData({ status: "timeout" });
    const { error, calls } = await refused(w);
    expect(error).toContain("gate g-post is still open");
    expect(outward(calls)).toEqual([]);
  });

  test("a planner refusal comes back as the error with nothing moved", async () => {
    const w = world();
    w.snapshot.decisions = w.snapshot.decisions.filter((d) => d.scope !== "respond-post");
    const { error, calls } = await refused(w);
    expect(error).toContain("respond-post has no decision recorded since its gate opened");
    expect(outward(calls)).toEqual([]);
  });

  test("a GitHub MR refuses before any gate read", async () => {
    const w = world();
    w.snapshot.fields = w.snapshot.fields.map((f) => (f.key === "mr" ? field("mr", "https://github.com/acme/app/pull/7", 50) : f));
    const { error, calls } = await refused(w);
    expect(error).toBe("GitLab only: respond_post_execute does not speak GitHub; reply to and resolve the threads with gh");
    expect(calls.map((c) => c.name)).toEqual(["run_snapshot"]);
  });

  test("runDb, tree and stage are required strings", async () => {
    const f = fake(world());
    const tool = mrCompositeToolDefs(f.deps).find((t) => t.name === "respond_post_execute")!;
    expect((await tool.handler({ runDb: RUN_DB, tree: "/w" }, ENV)).error).toBe('"stage" is required');
    expect((await tool.handler({ runDb: RUN_DB, tree: 3, stage: STAGE }, ENV)).error).toBe('"tree" must be a string');
    expect(f.calls).toEqual([]);
  });
});

describe("push, when a fix row is picked", () => {
  test("both git reads match, so it pushes once and the replies post", async () => {
    const { res, calls } = await done(world());
    expect(res.pushed).toEqual({ branch: "feat-x" });
    expect(pushCalls(calls)).toHaveLength(1);
    expect(pushCalls(calls)[0]!.payload).toEqual(["/w", "push", "--no-follow-tags", "--recurse-submodules=no", "--end-of-options", "origin", "HEAD:refs/heads/feat-x"]);
    expect(res.posted).toEqual(["T1", "T2"]);
    expect(res.resolved).toEqual(["T1"]);
    expect(res.held).toEqual([]);
  });

  test("the push comes after the posted-already read and before any reply", async () => {
    const { calls } = await done(world());
    const order = calls.map((c) => c.name);
    expect(order.indexOf("discussions:refresh")).toBeLessThan(order.findIndex((n) => n.startsWith("push")));
    expect(order.findIndex((n) => n.startsWith("push"))).toBeLessThan(order.indexOf("discussions:reply"));
  });

  test("@{push} printing upstream/feat-x holds T1 as a mismatch and T2 still posts", async () => {
    const w = world();
    w.git["rev-parse --abbrev-ref @{push}"] = gitOk("upstream/feat-x\n");
    const { res, calls } = await done(w);
    expect(res.held).toHaveLength(1);
    expect(res.held[0]!.threadId).toBe("T1");
    expect(res.held[0]!.kind).toBe("mismatch");
    expect(res.held[0]!.error).toContain("refs/heads/feat-x");
    expect(res.held[0]!.error).toContain("upstream/feat-x");
    expect(pushCalls(calls)).toEqual([]);
    expect(res.pushed).toBeNull();
    expect(res.posted).toEqual(["T2"]);
    expect(cmdCalls(calls, "discussions:reply").map((c) => (c.payload as Record<string, unknown>).discussionId)).toEqual(["T2"]);
    expect(cmdCalls(calls, "discussions:resolve")).toEqual([]);
  });

  test("@{u} on upstream/feat-x while @{push} is origin/feat-x holds T1 as a mismatch and T2 still posts", async () => {
    const w = world();
    w.git["rev-parse --abbrev-ref --symbolic-full-name @{u}"] = gitOk("upstream/feat-x\n");
    const { res, calls } = await done(w);
    expect(res.held.map((h) => [h.threadId, h.kind])).toEqual([["T1", "mismatch"]]);
    expect(res.held[0]!.error).toContain("upstream/feat-x");
    expect(res.held[0]!.error).toContain("@{u}");
    expect(pushCalls(calls)).toEqual([]);
    expect(res.pushed).toBeNull();
    expect(res.posted).toEqual(["T2"]);
    expect(cmdCalls(calls, "discussions:resolve")).toEqual([]);
  });

  test("a push that reports landing off origin holds T1 as push", async () => {
    const w = world();
    w.git["rev-parse --abbrev-ref --symbolic-full-name @{u}"] = [gitOk("origin/feat-x\n"), gitOk("upstream/feat-x\n")];
    w.git["symbolic-ref --quiet refs/remotes/upstream/HEAD"] = gitOk("refs/remotes/upstream/main\n");
    w.git["ls-remote --symref --end-of-options upstream HEAD"] = gitOk("ref: refs/heads/main\tHEAD\n");
    const { res, calls } = await done(w);
    expect(pushCalls(calls)).toHaveLength(1);
    expect(res.pushed).toBeNull();
    expect(res.held).toEqual([{ threadId: "T1", kind: "push", error: "git push went to upstream/feat-x, not origin/feat-x, so the fix is not on the MR's branch" }]);
    expect(res.posted).toEqual(["T2"]);
  });

  test("a symbolic-ref on another branch holds T1 as a mismatch", async () => {
    const w = world();
    w.git["symbolic-ref --quiet HEAD"] = gitOk("refs/heads/other\n");
    const { res, calls } = await done(w);
    expect(res.held.map((h) => [h.threadId, h.kind])).toEqual([["T1", "mismatch"]]);
    expect(res.held[0]!.error).toContain("refs/heads/other");
    expect(pushCalls(calls)).toEqual([]);
  });

  test("a detached HEAD holds T1 as a mismatch with git's error", async () => {
    const w = world();
    w.git["symbolic-ref --quiet HEAD"] = gitFail("fatal: ref HEAD is not a symbolic ref", 128);
    const { res } = await done(w);
    expect(res.held.map((h) => h.kind)).toEqual(["mismatch"]);
    expect(res.held[0]!.error).toContain("fatal: ref HEAD is not a symbolic ref");
  });

  test("the MR's own source branch is the expected branch when the run has none", async () => {
    const w = world();
    w.snapshot.fields = w.snapshot.fields.filter((f) => f.key !== "branch");
    const { res, calls } = await done(w);
    expect(cmdCalls(calls, "mr:get").map((c) => c.payload)).toEqual([{ repoName: ID, iid: 7 }]);
    expect(res.pushed).toEqual({ branch: "feat-x" });
  });

  test("a branch field that is not the MR's source branch holds T1 as a mismatch", async () => {
    const w = world();
    w.cmd["mr:get"] = [okData({ mr: { sourceBranch: "feat-y" } })];
    const { res, calls } = await done(w);
    expect(res.held.map((h) => [h.threadId, h.kind])).toEqual([["T1", "mismatch"]]);
    expect(res.held[0]!.error).toContain("feat-y");
    expect(pushCalls(calls)).toEqual([]);
  });

  test("the push failing twice holds T1 with git's text, and T2 still posts", async () => {
    const w = world();
    w.pushes = [gitFail("! [rejected] feat-x -> feat-x (fetch first)")];
    const { res, calls } = await done(w);
    expect(pushCalls(calls)).toHaveLength(2);
    expect(res.held).toEqual([{ threadId: "T1", kind: "push", error: "git push failed: ! [rejected] feat-x -> feat-x (fetch first)" }]);
    expect(res.pushed).toBeNull();
    expect(res.posted).toEqual(["T2"]);
  });

  test("the push failing then succeeding is pushed", async () => {
    const w = world();
    w.pushes = [gitFail("remote hung up"), gitOk("")];
    const { res, calls } = await done(w);
    expect(pushCalls(calls)).toHaveLength(2);
    expect(res.pushed).toEqual({ branch: "feat-x" });
    expect(res.held).toEqual([]);
  });

  test("with no fix row picked, git is never called", async () => {
    const w = world();
    noFixRow(w);
    const { res, calls } = await done(w);
    expect(gitCalls(calls)).toEqual([]);
    expect(res.pushed).toBeNull();
    expect(res.posted).toEqual(["T2"]);
  });

  test("an offered fix row picked for neither post nor resolve pushes nothing", async () => {
    const w = world();
    w.snapshot.decisions = [w.snapshot.decisions[0]!, decision("respond-post", { threads: { T1: { post: false, resolve: false } } }, 4_000)];
    w.gates["g-post"] = okData({ status: "answered", row: row("g-post", POST_T1, { "thread-1": [], next: "proceed" }, 3_000) });
    const { res, calls } = await done(w);
    expect(gitCalls(calls)).toEqual([]);
    expect(res.posted).toEqual(["T2"]);
  });

  test("an unregistered tree refuses before any outward call when a push is due", async () => {
    const w = world();
    w.tree = "/elsewhere";
    const { error, calls } = await refused(w);
    expect(error).toContain("tree must be the absolute path of the root of a checkout or worktree");
    expect(outward(calls)).toEqual([]);
  });

  test("a tree of another repo refuses before any outward call", async () => {
    const w = world();
    const f = fake(w);
    f.deps.guard = { ...f.deps.guard, repoIndex: () => ({ "remote:gitlab.com%2Fother%2Frepo": "/w" }) };
    const r = await executeRespondPost(f.deps, { runDb: RUN_DB, tree: "/w", stage: STAGE }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("remote:gitlab.com%2Fother%2Frepo");
    expect(outward(f.calls)).toEqual([]);
  });

  test("an unregistered tree is fine when nothing pushes", async () => {
    const w = world();
    noFixRow(w);
    w.tree = "/elsewhere";
    const { res } = await done(w);
    expect(res.posted).toEqual(["T2"]);
  });
});

describe("replies", () => {
  test("each reply goes to its thread with its body", async () => {
    const { calls } = await done(world());
    expect(cmdCalls(calls, "discussions:reply").map((c) => c.payload)).toEqual([
      { repoName: ID, iid: 7, discussionId: "T1", body: T1_FIXED },
      { repoName: ID, iid: 7, discussionId: "T2", body: T2_VERBATIM },
    ]);
    expect(cmdCalls(calls, "discussions:resolve").map((c) => c.payload)).toEqual([{ repoName: ID, iid: 7, discussionId: "T1", resolved: true }]);
  });

  test("a reply that errored but landed is counted, not retried", async () => {
    const w = world();
    w.cmd["discussions:reply"] = [fail("504 Gateway Timeout"), okData({ discussions: [], fetchedAt: 1, noteId: 901 })];
    const landed = [disc("T1", [note(1, "please"), note(77, `${T1_FIXED}\r\n`, "someone", T_PRE)]), disc("T2", [note(2, "why delay?")])];
    w.cmd["discussions:refresh"] = [okData({ discussions: fresh(), fetchedAt: 1 }), okData({ discussions: landed, fetchedAt: 2 })];
    const { res, calls } = await done(w);
    expect(res.posted).toEqual(["T1", "T2"]);
    expect(cmdCalls(calls, "discussions:reply").map((c) => (c.payload as Record<string, unknown>).discussionId)).toEqual(["T1", "T2"]);
  });

  test("a reply that errored and did not land is retried once", async () => {
    const w = world();
    w.cmd["discussions:reply"] = [fail("502 Bad Gateway"), okData({ discussions: [], fetchedAt: 1, noteId: 901 })];
    const { res, calls } = await done(w);
    expect(res.posted).toEqual(["T1", "T2"]);
    expect(cmdCalls(calls, "discussions:reply").map((c) => (c.payload as Record<string, unknown>).discussionId)).toEqual(["T1", "T1", "T2"]);
  });

  test("a reply erroring twice holds the thread and skips its resolve", async () => {
    const w = world();
    w.cmd["discussions:reply"] = [fail("403 Forbidden"), fail("403 Forbidden"), okData({ discussions: [], fetchedAt: 1, noteId: 902 })];
    const { res, calls } = await done(w);
    expect(res.held).toEqual([{ threadId: "T1", kind: "reply", error: "403 Forbidden" }]);
    expect(res.posted).toEqual(["T2"]);
    expect(cmdCalls(calls, "discussions:resolve")).toEqual([]);
    expect(res.resolved).toEqual([]);
  });

  test("a reply whose re-read fails is held, not retried", async () => {
    const w = world();
    w.cmd["discussions:reply"] = [fail("504 Gateway Timeout"), okData({ discussions: [], fetchedAt: 1, noteId: 902 })];
    w.cmd["discussions:refresh"] = [okData({ discussions: fresh(), fetchedAt: 1 }), fail("503 Service Unavailable"), okData({ discussions: fresh(), fetchedAt: 1 })];
    const { res, calls } = await done(w);
    expect(res.held.map((h) => [h.threadId, h.kind])).toEqual([["T1", "reply"]]);
    expect(res.held[0]!.error).toContain("504 Gateway Timeout");
    expect(res.held[0]!.error).toContain("503 Service Unavailable");
    expect(cmdCalls(calls, "discussions:reply").map((c) => (c.payload as Record<string, unknown>).discussionId)).toEqual(["T1", "T2"]);
  });

  test("a resolve erroring twice holds the thread", async () => {
    const w = world();
    w.cmd["discussions:resolve"] = [fail("500 Internal Server Error")];
    const { res, calls } = await done(w);
    expect(cmdCalls(calls, "discussions:resolve")).toHaveLength(2);
    expect(res.held).toEqual([{ threadId: "T1", kind: "resolve", error: "500 Internal Server Error" }]);
    expect(res.posted).toEqual(["T1", "T2"]);
  });

  test("a resolve erroring then succeeding is resolved", async () => {
    const w = world();
    w.cmd["discussions:resolve"] = [fail("500 Internal Server Error"), okData({ discussions: [], fetchedAt: 1 })];
    const { res } = await done(w);
    expect(res.resolved).toEqual(["T1"]);
    expect(res.held).toEqual([]);
  });

  test("a thread the read showed resolved counts as alreadyResolved", async () => {
    const w = world();
    w.cmd["discussions:refresh"] = [okData({ discussions: [disc("T1", [note(1, "please")], true), disc("T2", [note(2, "why delay?")])], fetchedAt: 1 })];
    const { res, calls } = await done(w);
    expect(res.alreadyResolved).toEqual(["T1"]);
    expect(res.resolved).toEqual([]);
    expect(cmdCalls(calls, "discussions:resolve")).toEqual([]);
  });

  test("re-run after a partial pass posts nothing twice", async () => {
    const w = world();
    w.cmd["discussions:refresh"] = [okData({
      discussions: [disc("T1", [note(1, "please"), note(31, T1_FIXED, "me-bot", T_POST)], true), disc("T2", [note(2, "why delay?"), note(32, T2_VERBATIM, "me-bot", T_POST)])],
      fetchedAt: 1,
    })];
    const { res, calls } = await done(w);
    expect(res.alreadyPosted).toEqual([{ threadId: "T1", noteId: 31 }, { threadId: "T2", noteId: 32 }]);
    expect(res.posted).toEqual([]);
    expect(res.alreadyResolved).toEqual(["T1"]);
    expect(cmdCalls(calls, "discussions:reply")).toEqual([]);
    expect(cmdCalls(calls, "discussions:resolve")).toEqual([]);
  });

  test("a note by this account after the run started counts as posted", async () => {
    const w = world();
    w.cmd["discussions:refresh"] = [okData({ discussions: [disc("T1", [note(1, "please"), note(41, "Fixed, different words", "me-bot", T_POST)]), disc("T2", [note(2, "why delay?")])], fetchedAt: 1 })];
    const { res, calls } = await done(w);
    expect(res.alreadyPosted).toEqual([{ threadId: "T1", noteId: 41 }]);
    expect(cmdCalls(calls, "discussions:reply").map((c) => (c.payload as Record<string, unknown>).discussionId)).toEqual(["T2"]);
  });

  test("the posted-already read asks forge:get user once", async () => {
    const { calls } = await done(world());
    expect(cmdCalls(calls, "forge:get").map((c) => c.payload)).toEqual([{ repoName: ID, path: "user" }]);
    expect(cmdCalls(calls, "discussions:refresh")).toHaveLength(1);
  });
});

describe("the read fails", () => {
  for (const [label, edit] of [
    ["the thread read errors", (w: World) => { w.cmd["discussions:refresh"] = [fail("503 Service Unavailable")]; }],
    ["the user read errors", (w: World) => { w.cmd["forge:get"] = [fail("401 Unauthorized")]; }],
    ["a thread GitLab no longer returns", (w: World) => { w.cmd["discussions:refresh"] = [okData({ discussions: [disc("T2", [note(2, "why delay?")])], fetchedAt: 1 })]; }],
  ] as const) {
    test(`${label}: every thread is held as read, nothing moves, hold is set`, async () => {
      const w = world();
      edit(w);
      const { res, calls } = await done(w);
      expect(res.held.map((h) => [h.threadId, h.kind])).toEqual([["T1", "read"], ["T2", "read"]]);
      expect(gitCalls(calls)).toEqual([]);
      expect(cmdCalls(calls, "discussions:reply")).toEqual([]);
      expect(cmdCalls(calls, "discussions:resolve")).toEqual([]);
      expect(named(calls, "run_decision")).toEqual([]);
      expect(named(calls, "run_field_set").map((c) => c.payload)).toEqual([{ runDb: RUN_DB, key: "hold", value: "held", stage: STAGE }]);
      expect(res.recorded).toBe(false);
      expect(res.hold).toBe("held");
    });
  }
});

describe("record", () => {
  test("after a held pass it re-records respond-post with the same decidedBy and held", async () => {
    const w = world();
    w.git["rev-parse --abbrev-ref @{push}"] = gitOk("upstream/feat-x\n");
    const { res, calls } = await done(w);
    expect(named(calls, "run_decision").map((c) => c.payload)).toEqual([{
      runDb: RUN_DB, contract: "gate@1", scope: "respond-post", decidedBy: "matt",
      selection: { threads: { T1: { post: true, resolve: true } }, held: ["T1"] },
    }]);
    expect(named(calls, "run_field_set").map((c) => c.payload)).toEqual([{ runDb: RUN_DB, key: "hold", value: "held", stage: STAGE }]);
    expect(res.recorded).toBe(true);
    expect(res.hold).toBe("held");
  });

  test("a clean pass re-records with no held key and leaves hold alone", async () => {
    const { res, calls } = await done(world());
    expect(named(calls, "run_decision").map((c) => c.payload)).toEqual([{
      runDb: RUN_DB, contract: "gate@1", scope: "respond-post", decidedBy: "matt",
      selection: { threads: { T1: { post: true, resolve: true } } },
    }]);
    expect(named(calls, "run_field_set")).toEqual([]);
    expect(res.recorded).toBe(true);
    expect(res.hold).toBeNull();
  });

  test("with no post decision there is no run_decision call", async () => {
    const w = world();
    noFixRow(w);
    const { res, calls } = await done(w);
    expect(named(calls, "run_decision")).toEqual([]);
    expect(res.recorded).toBe(false);
  });

  test("a failed re-record reads recorded false with its error in writeErrors", async () => {
    const w = world();
    w.runFail = { run_decision: "database is locked" };
    const { res } = await done(w);
    expect(res.recorded).toBe(false);
    expect(res.writeErrors).toEqual(["re-recording the respond-post decision failed: database is locked"]);
  });

  test("a failed hold write reads hold null with its error in writeErrors", async () => {
    const w = world();
    w.git["rev-parse --abbrev-ref @{push}"] = gitOk("upstream/feat-x\n");
    w.runFail = { run_field_set: "database is locked" };
    const { res } = await done(w);
    expect(res.held).toHaveLength(1);
    expect(res.hold).toBeNull();
    expect(res.recorded).toBe(true);
    expect(res.writeErrors).toEqual(["setting the hold field failed: database is locked"]);
  });

  test("a clean pass carries no writeErrors", async () => {
    const { res } = await done(world());
    expect(res.writeErrors).toBeUndefined();
  });

  test("the record goes last, after every resolve", async () => {
    const { calls } = await done(world());
    const order = calls.map((c) => c.name);
    expect(order.lastIndexOf("discussions:resolve")).toBeLessThan(order.indexOf("run_decision"));
  });
});

describe("held resume", () => {
  test("held T2 acts on T2 only and does not push for the T1 fix row", async () => {
    const w = world();
    offerBoth(w, ["T2"]);
    const { res, calls } = await done(w);
    expect(gitCalls(calls)).toEqual([]);
    expect(res.pushed).toBeNull();
    expect(res.posted).toEqual(["T2"]);
    expect(res.resolved).toEqual(["T2"]);
    expect(cmdCalls(calls, "discussions:reply").map((c) => (c.payload as Record<string, unknown>).body)).toEqual([T2_OVERRIDE]);
    expect((named(calls, "run_decision")[0]!.payload as Record<string, unknown>).selection).toEqual({
      threads: { T1: { post: true, resolve: true }, T2: { post: true, resolve: true } },
    });
  });

  test("held T1 pushes because T1 is a fix row, and leaves T2 alone", async () => {
    const w = world();
    offerBoth(w, ["T1"]);
    const { res, calls } = await done(w);
    expect(pushCalls(calls)).toHaveLength(1);
    expect(res.pushed).toEqual({ branch: "feat-x" });
    expect(res.posted).toEqual(["T1"]);
  });

  test("a thread still held replaces the old held list", async () => {
    const w = world();
    offerBoth(w, ["T1", "T2"]);
    w.pushes = [gitFail("remote hung up")];
    const { res, calls } = await done(w);
    expect(res.held.map((h) => [h.threadId, h.kind])).toEqual([["T1", "push"]]);
    expect(res.posted).toEqual(["T2"]);
    expect(((named(calls, "run_decision")[0]!.payload as Record<string, unknown>).selection as Record<string, unknown>).held).toEqual(["T1"]);
  });
});

describe("progress", () => {
  test("it ticks after each outward call", async () => {
    const { calls, ticks } = await run(world());
    expect(ticks).toBeGreaterThanOrEqual(cmdCalls(calls, "discussions:reply").length + cmdCalls(calls, "discussions:resolve").length + pushCalls(calls).length + 2);
  });
});

describe("the tool", () => {
  test("its description states the four rules in order and starts GitLab only", () => {
    const t = mrCompositeToolDefs(fake(world()).deps).find((x) => x.name === "respond_post_execute")!;
    expect(t.description).toStartWith("GitLab only.");
    const at = (s: string) => t.description.indexOf(s);
    for (const s of ["recorded", "retried once", "held", "GitHub"]) expect(at(s)).toBeGreaterThan(-1);
    expect(at("recorded")).toBeLessThan(at("retried once"));
    expect(at("retried once")).toBeLessThan(at("held[]"));
    expect(at("held[]")).toBeLessThan(at("GitHub"));
    expect(t.shellForms).toEqual({ none: "composes git_push, mr_reply_thread and mr_resolve_thread; no single shell command is equivalent" });
    expect(t.inputSchema).toMatchObject({ required: ["runDb", "tree", "stage"] });
  });

  test("the handler passes progress through", async () => {
    const f = fake(world());
    let ticks = 0;
    const tool = mrCompositeToolDefs(f.deps).find((x) => x.name === "respond_post_execute")!;
    const r = await tool.handler({ runDb: RUN_DB, tree: "/w", stage: STAGE }, ENV, undefined, () => { ticks++; });
    expect(r.ok).toBe(true);
    expect(ticks).toBeGreaterThan(0);
  });
});
