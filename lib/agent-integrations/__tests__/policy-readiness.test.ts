import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  Capability, CapabilityReport, Mode, NativeSessionRef, Outcome, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb } from "../../state/db.ts";
import { codexPolicyManifest } from "../codex/hook-manifest.ts";
import { createCodexPolicy, type CodexPolicyChecker } from "../codex/policy.ts";
import type { CodexListedHook } from "../codex/sessions.ts";
import { createCodexPolicyReceipts, type CodexPolicyReceipts, type CodexReceiptInput } from "../codex/policy-receipts.ts";
import type { HarnessIntegration, LaunchRequest, PolicyAdapter, PolicyProof, SessionAdapter } from "../contracts.ts";
import { createBoundLauncher, type BoundLaunchRequest } from "../launch.ts";
import { recordPolicyProof, requirePolicyProof } from "../policy-readiness.ts";
import { createRegistry } from "../registry.ts";
import { createSessionStore, readBindingReadiness } from "../session-store.ts";

const THREAD = "019a0000-0000-7000-8000-000000000001";
const DIAG = "019a0000-0000-7000-8000-00000000d1a6";
const EXE = "/opt/mattstack/2.30.0/Contents/Helpers/rt";
const OLD_EXE = "/opt/mattstack/2.29.0/Contents/Helpers/rt";
const INSTALLATION = "inst-test-1";

let dir = "";
let db: Database;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-policy-readiness-")));
  db = openStateDb(join(dir, "state.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });

function data<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.data;
}

function bind(harness: string, value = THREAD, profile = "default"): SessionBinding {
  const store = createSessionStore(db);
  const native: NativeSessionRef = { harness, profile, kind: "id", value };
  return data(store.bind(store.reserve({ identity: `w-${value}` }), native, { mode: "headless" }));
}

/** The hooks file the last project() installed, which the fake app server lists as the one Codex loads unless a test says otherwise. */
let installed: { source: string; executable: string } = { source: "", executable: EXE };

/** hooks/list's entries for rt's two policy hooks, loaded from `source`, shaped like Codex 0.162's answer. */
function listing(source = installed.source, executable = installed.executable): CodexListedHook[] {
  return (["PreToolUse", "Stop"] as const).map((event) => ({
    eventName: event === "Stop" ? "stop" : "preToolUse", handlerType: "command", source: "project", sourcePath: source, enabled: true,
    command: codexPolicyManifest({ executable, installationId: INSTALLATION }).hooks[event][0]!.hooks[0]!.command,
  }));
}

/** A pool tree linked to a project's checkout the way `git worktree add` links one: a .git file naming its gitdir, whose commondir is the main .git. */
function linkedTree(main: string, name = "t1"): string {
  const tree = join(dir, "pool", name);
  const gitDir = join(main, ".git", "worktrees", name);
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  writeFileSync(join(gitDir, "gitdir"), `${join(tree, ".git")}\n`);
  writeFileSync(join(tree, ".git"), `gitdir: ${gitDir}\n`);
  return tree;
}

/** live-16's hooks/list answer for a pool tree (evidence d1-hooks-list-t1.json), with this test's paths in it. */
function recordedListing(main: string, tree: string, executable = EXE): CodexListedHook[] {
  const text = readFileSync(join(import.meta.dir, "fixtures", "codex", "hooks-list-linked-worktree-0.162.json"), "utf8")
    .replaceAll("{{TREE}}", tree).replaceAll("{{MAIN}}", main).replaceAll("{{EXE}}", executable).replaceAll("{{INSTALLATION}}", INSTALLATION);
  const entry = (JSON.parse(text) as { result: { data: Array<{ cwd: string; hooks: CodexListedHook[] }> } }).result.data[0]!;
  expect(entry.cwd).toBe(tree);
  return entry.hooks;
}

/** A project whose .codex layer installs rt's reviewed manifest, with folder and hook trust recorded for it. */
function project(executable = EXE) {
  const root = join(dir, "project");
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".codex"), { recursive: true });
  const manifest = codexPolicyManifest({ executable, installationId: INSTALLATION });
  const source = join(root, ".codex", "hooks.json");
  writeFileSync(source, JSON.stringify({ hooks: manifest.hooks }, null, 2));
  const home = join(dir, "codex-home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.toml"), [
    `[projects.${JSON.stringify(root)}]`, `trust_level = "trusted"`,
    `[hooks.state.${JSON.stringify(`${source}:pre_tool_use:0:0`)}]`, `trusted_hash = "sha256:${"a".repeat(64)}"`,
    `[hooks.state.${JSON.stringify(`${source}:stop:0:0`)}]`, `trusted_hash = "sha256:${"b".repeat(64)}"`,
  ].join("\n") + "\n");
  installed = { source, executable };
  return { root, source, home, manifest, env: { HOME: dir, CODEX_HOME: home } as NodeJS.ProcessEnv };
}

function launchRequest(cwd: string, over: Partial<LaunchRequest> = {}): LaunchRequest {
  return { reservationId: "res-1", cwd, mode: "headless", selection: { harness: "codex", options: {} }, required: [], access: { readRoots: [] }, ...over };
}

type Hook = { event: "PreToolUse" | "Stop"; receipt?: Partial<CodexReceiptInput> | false; run?: Record<string, unknown> | false };

/** What the bound session's hooks do during a turn: each hook may receipt, and Codex may report its run. */
function simulate(store: CodexPolicyReceipts, binding: SessionBinding, source: string, revision: string, hooks: Hook[], turnId = DIAG): void {
  for (const hook of hooks) {
    if (hook.receipt !== false) {
      store.record({
        sessionKey: binding.key, generation: binding.attachment.generation, threadId: binding.native.value, turnId,
        event: hook.event, ...(hook.event === "PreToolUse" && { tool: "Bash" }), verdict: "allow",
        installation: INSTALLATION, revision, turn: "current", threadEnv: "absent", ...hook.receipt,
      });
    }
    if (hook.run !== false) {
      store.observe({
        threadId: binding.native.value, turnId, id: `${hook.event}:1`, eventName: hook.event === "Stop" ? "stop" : "preToolUse",
        status: "completed", sourcePath: source, source: "project", handlerType: "command", ...hook.run,
      });
    }
  }
}

const BOTH: Hook[] = [{ event: "PreToolUse" }, { event: "Stop" }];

/** A live session whose check turn runs `act` between the turn starting and its end. */
function checker(
  act: (turnId: string, binding: SessionBinding) => void,
  opts: { turnId?: string; issueAfter?: boolean; status?: string; calls?: string[]; listed?: Outcome<CodexListedHook[]>; listedFor?: string[] } = {},
): CodexPolicyChecker {
  return {
    async listHooks(cwd) {
      opts.listedFor?.push(cwd);
      return opts.listed ?? ok(listing());
    },
    async policyCheck(binding, run) {
      opts.calls?.push(run.prompt);
      const turnId = opts.turnId ?? DIAG;
      if (opts.issueAfter) act(turnId, binding);
      run.issue(turnId);
      if (!opts.issueAfter) act(turnId, binding);
      await run.settle();
      return ok({ turnId, status: opts.status ?? "completed" });
    },
  };
}

function codexPolicy(p: ReturnType<typeof project>, store: CodexPolicyReceipts, check: CodexPolicyChecker | undefined, fingerprint = () => "rt 2.30.0") {
  return createCodexPolicy({
    env: p.env, artifact: () => undefined, fingerprint, now: () => 7, receipts: store, checker: async () => check, sleep: async () => {},
  });
}

async function proveCodex(p: ReturnType<typeof project>, binding: SessionBinding, hooks: Hook[] = BOTH, opts: Parameters<typeof checker>[1] = {}) {
  const store = createCodexPolicyReceipts();
  const policy = codexPolicy(p, store, checker((turnId) => simulate(store, binding, p.source, p.manifest.revision, hooks, turnId), opts));
  const prepared = data(await policy.prepare(launchRequest(p.root)));
  return { store, policy, prepared, verified: await policy.verify(binding, prepared, { kind: "launch" }) };
}

const observed = (b: SessionBinding) => ok({
  connectivity: "unknown" as const, execution: "unknown" as const, background: "unknown" as const, observedAt: 1, source: "none" as const, generation: b.attachment.generation,
});

/** A session adapter that records every native call; launch and resume make the same thread. */
function fakeSessions(native: NativeSessionRef, order: string[] = []): SessionAdapter {
  return {
    async launch(req) {
      order.push("launch");
      return ok({ native, attachment: { mode: req.mode } });
    },
    async resume(ref, req) {
      order.push("resume");
      return ok({ native: ref, attachment: { mode: req.mode } });
    },
    discover: async () => [],
    observe: async (b) => observed(b),
    async startWork(b, input) {
      order.push("work");
      return ok({ id: input.id, evidence: "submitted", nativeId: b.native.value });
    },
  };
}

function fakeIntegration(sessions: SessionAdapter, policy: PolicyAdapter, opts: { revision?: () => string; id?: string; kind?: "installation" | "receipts" | null } = {}): HarnessIntegration {
  const wrapped: PolicyAdapter = opts.revision
    ? { ...policy, prepare: async (req) => ok({ id: "pp", harness: opts.id ?? "fake", profile: "default", cwd: req.cwd, revision: opts.revision!() }) }
    : policy;
  return {
    id: opts.id ?? "fake", label: opts.id ?? "fake",
    ...(opts.kind !== null && { policyProofKind: opts.kind ?? "installation" }),
    capabilities: async (mode: Mode): Promise<CapabilityReport> => ({
      mode, supported: ["launch", "resume", "observe", "gate-policy", "continuation-policy"], readiness: { ready: true },
    }),
    validateOptions: (options: object) => ok(options),
    options: async () => [],
    loadSessions: async () => sessions,
    loadPolicy: async () => wrapped,
  } as unknown as HarnessIntegration;
}

function launcherOf(integration: HarnessIntegration, enabled: () => boolean = () => true) {
  return createBoundLauncher({ db, registry: createRegistry([integration]), claimToken: "proc-A", enabled });
}

const installationProof = (b: SessionBinding, revision: string, verified: Capability[] = ["gate-policy"]): PolicyProof =>
  ({ sessionKey: b.key, generation: b.attachment.generation, revision, verified, observedAt: 1, kind: "installation" });

describe("trusted inventory without executed receipts is not ready", () => {
  test("a clean check turn proves both hook entry points for exactly this session", async () => {
    const p = project();
    const binding = bind("codex", THREAD, p.home);
    const { verified, prepared } = await proveCodex(p, binding);
    const proof = data(verified);
    expect(proof).toMatchObject({
      sessionKey: binding.key, generation: binding.attachment.generation, revision: prepared.revision, kind: "receipts", observedAt: 7,
      evidence: { turnId: DIAG, sourcePath: p.source, manifest: p.manifest.revision, runs: { PreToolUse: "PreToolUse:1", Stop: "Stop:1" } },
    });
    expect([...proof.verified].sort()).toEqual(["continuation-policy", "gate-policy"]);
    expect(proof.evidence!.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(recordPolicyProof(binding, proof, db)).toEqual({ ok: true, data: undefined });
    expect(requirePolicyProof(binding, ["gate-policy", "continuation-policy"], prepared.revision, db)).toEqual({ ok: true, data: undefined });
  });

  test("a manifest naming a wrapper script or a symlink proves, and a changed executable behind it is still caught", async () => {
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    const wrapper = join(bin, "rt");
    writeFileSync(wrapper, "#!/bin/sh\nexec /opt/mattstack/2.30.0/Contents/Helpers/rt \"$@\"\n");
    const link = join(bin, "rt-link");
    symlinkSync(wrapper, link);
    for (const executable of [wrapper, link]) {
      rmSync(join(dir, "project"), { recursive: true, force: true });
      const p = project(executable);
      const binding = bind("codex", `${THREAD}-${executable.length}`, p.home);
      const store = createCodexPolicyReceipts();
      // The hook names this revision from its --executable, whatever binary runs it.
      const named = codexPolicyManifest({ executable, installationId: INSTALLATION }).revision;
      const policy = createCodexPolicy({
        env: p.env, artifact: () => undefined, now: () => 7, receipts: store, sleep: async () => {},
        checker: async () => checker((turnId) => simulate(store, binding, p.source, named, BOTH, turnId)),
      });
      const prepared = data(await policy.prepare(launchRequest(p.root)));
      expect({ executable, ok: (await policy.verify(binding, prepared, { kind: "launch" })).ok }).toEqual({ executable, ok: true });
      writeFileSync(wrapper, "#!/bin/sh\nexec /opt/mattstack/2.31.0/Contents/Helpers/rt \"$@\"\n");
      expect(await policy.verify(binding, prepared, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("changed") } });
      writeFileSync(wrapper, "#!/bin/sh\nexec /opt/mattstack/2.30.0/Contents/Helpers/rt \"$@\"\n");
    }
  });

  test("hooks that fired before the turn id was known still count", async () => {
    const p = project();
    const binding = bind("codex", THREAD, p.home);
    expect((await proveCodex(p, binding, BOTH, { issueAfter: true })).verified.ok).toBe(true);
  });

  test("inventory alone, a receipt with no native run, or a run with no receipt is not ready", async () => {
    const p = project();
    const cases: Array<[string, Hook[]]> = [
      ["no hook ran", []],
      ["receipts only", [{ event: "PreToolUse", run: false }, { event: "Stop", run: false }]],
      ["runs only", [{ event: "PreToolUse", receipt: false }, { event: "Stop", receipt: false }]],
      ["Stop never ran", [{ event: "PreToolUse" }]],
      ["PreToolUse never ran", [{ event: "Stop" }]],
    ];
    for (const [name, hooks] of cases) {
      const binding = bind("codex", `${THREAD}-${name.length}-${hooks.length}`, p.home);
      const { verified } = await proveCodex(p, binding, hooks);
      expect({ name, ok: verified.ok }).toEqual({ name, ok: false });
      if (!verified.ok) expect({ name, code: verified.error.code }).toEqual({ name, code: "not-ready" });
    }
  });

  test("no live connection, a connection that fails, a check that throws or does not complete, or a policy service failure is not ready", async () => {
    const p = project();
    const binding = bind("codex", THREAD, p.home);
    const none = codexPolicy(p, createCodexPolicyReceipts(), undefined);
    const prepared = data(await none.prepare(launchRequest(p.root)));
    expect(await none.verify(binding, prepared, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready" } });

    const failing = createCodexPolicy({ env: p.env, artifact: () => undefined, fingerprint: () => "rt 2.30.0", checker: async () => { throw new Error("codex is not installed"); } });
    expect(await failing.verify(binding, prepared, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("codex is not installed") } });
    const throwing = codexPolicy(p, createCodexPolicyReceipts(), { listHooks: async () => ok(listing()), policyCheck: async () => { throw new Error("socket closed"); } });
    expect(await throwing.verify(binding, prepared, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("socket closed") } });

    expect((await proveCodex(p, binding, BOTH, { status: "interrupted" })).verified).toMatchObject({ ok: false, error: { code: "not-ready" } });
    const unavailable = await proveCodex(p, binding, [{ event: "PreToolUse" }, { event: "Stop", receipt: { verdict: "unavailable" }, run: {} }]);
    expect(unavailable.verified).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("could not decide") } });
  });

  test("the check turn's prompt asks for one harmless shell command and nothing else", async () => {
    const p = project();
    const binding = bind("codex", THREAD, p.home);
    const calls: string[] = [];
    await proveCodex(p, binding, BOTH, { calls });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("`true`");
  });

  test("a launch that requires policy sends no work until its session proved it", async () => {
    const order: string[] = [];
    let proven = false;
    const policy: PolicyAdapter = {
      prepare: async () => { throw new Error("replaced"); },
      async verify(b, prepared) {
        order.push("verify");
        if (!proven) return { ok: false, error: { code: "not-ready", message: "the check turn produced no receipts" } };
        return ok(installationProof(b, prepared.revision));
      },
    };
    const native: NativeSessionRef = { harness: "fake", profile: "default", kind: "id", value: "T1" };
    const launcher = launcherOf(fakeIntegration(fakeSessions(native, order), policy, { revision: () => "rev-1" }));
    const store = createSessionStore(db);
    const req = { reservationId: store.reserve({ identity: "w" }), cwd: "/w/a", mode: "headless" as Mode, selection: { harness: "fake", options: {} }, required: ["gate-policy"] as Capability[], access: { readRoots: [] } };
    expect(await launcher.launchBoundAgent(req)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(order).toEqual(["launch", "verify"]);
    const [binding] = createSessionStore(db).listByNativeValue("T1");
    expect(readBindingReadiness(db, binding!.key)?.generation).toBeNull();
    expect(await launcher.startBoundWork(binding!, { id: "w1", text: "go" }, async () => ok(undefined))).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(order).not.toContain("work");

    proven = true;
    const ready = data(await launcher.launchBoundAgent(req));
    data(await launcher.startBoundWork(ready, { id: "w1", text: "go" }, async () => ok(undefined)));
    expect(order).toEqual(["launch", "verify", "verify", "work"]);
  });

  test("a policy that throws while inspecting or verifying is not ready, on a first launch and on its retry, never an unknown launch", async () => {
    let throwIn: "prepare" | "verify" | null = "verify";
    const policy: PolicyAdapter = {
      async prepare(req) {
        if (throwIn === "prepare") throw new Error("hooks unreadable");
        return ok({ id: "pp", harness: "fake", profile: "default", cwd: req.cwd, revision: "rev-1" });
      },
      async verify(b, prepared) {
        if (throwIn === "verify") throw new Error("app server gone");
        return ok(installationProof(b, prepared.revision));
      },
    };
    const native: NativeSessionRef = { harness: "fake", profile: "default", kind: "id", value: "T2" };
    const launcher = launcherOf(fakeIntegration(fakeSessions(native), policy));
    const store = createSessionStore(db);
    const req = { reservationId: store.reserve({ identity: "w" }), cwd: "/w/b", mode: "headless" as Mode, selection: { harness: "fake", options: {} }, required: ["gate-policy"] as Capability[], access: { readRoots: [] } };
    expect(await launcher.launchBoundAgent(req)).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("app server gone") } });
    throwIn = "prepare";
    expect(await launcher.launchBoundAgent(req)).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("hooks unreadable") } });
    const fresh = { ...req, reservationId: store.reserve({ identity: "w2" }), cwd: "/w/c" };
    expect(await launcher.launchBoundAgent(fresh)).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("hooks unreadable") } });
    throwIn = null;
    data(await launcher.launchBoundAgent(req));
  });
});

describe("a linked worktree's project layer is its main checkout's, as Codex loads it", () => {
  test("a pool tree proves the hooks Codex lists from the main checkout, and the proof names that file", async () => {
    const p = project();
    const tree = linkedTree(p.root);
    const binding = bind("codex", THREAD, p.home);
    const store = createCodexPolicyReceipts();
    const listedFor: string[] = [];
    const policy = codexPolicy(p, store, checker(
      (turnId) => simulate(store, binding, p.source, p.manifest.revision, BOTH, turnId),
      { listed: ok(recordedListing(p.root, tree)), listedFor },
    ));
    const prepared = data(await policy.prepare(launchRequest(tree)));
    expect(prepared.cwd).toBe(tree);
    const proof = data(await policy.verify(binding, prepared, { kind: "launch" }));
    expect(proof.evidence).toMatchObject({ sourcePath: p.source, runs: { PreToolUse: "PreToolUse:1", Stop: "Stop:1" } });
    expect(listedFor).toEqual([tree]);
  });

  test("a folder inside a pool tree reads the main checkout's layer too", async () => {
    const p = project();
    const sub = join(linkedTree(p.root), "packages", "app");
    mkdirSync(sub, { recursive: true });
    const binding = bind("codex", THREAD, p.home);
    const store = createCodexPolicyReceipts();
    const policy = codexPolicy(p, store, checker((turnId) => simulate(store, binding, p.source, p.manifest.revision, BOTH, turnId)));
    const prepared = data(await policy.prepare(launchRequest(sub)));
    expect(data(await policy.verify(binding, prepared, { kind: "launch" })).evidence?.sourcePath).toBe(p.source);
  });

  test("hooks Codex lists from another file, layer or count than the inspected one prove nothing and start no check turn", async () => {
    const p = project();
    const tree = linkedTree(p.root);
    const elsewhere = join(tree, ".codex", "hooks.json");
    const [pre, stop] = listing(p.source);
    const cases: Array<[string, Outcome<CodexListedHook[]>, string]> = [
      ["the tree's own path", ok(listing(elsewhere)), elsewhere],
      ["a user layer", ok([{ ...pre!, source: "user" }, stop!]), "user"],
      ["a second Stop", ok([pre!, stop!, { ...stop!, sourcePath: elsewhere }]), "2 copies of rt's Stop"],
      ["no PreToolUse", ok([stop!]), "0 copies of rt's PreToolUse"],
      ["a disabled hook", ok([{ ...pre!, enabled: false }, stop!]), "disabled"],
      ["hooks/list failed", { ok: false, error: { code: "not-ready", message: "the control connection is closed" } }, "the control connection is closed"],
    ];
    for (const [name, listed, why] of cases) {
      const binding = bind("codex", `${THREAD}-${name.length}`, p.home);
      const store = createCodexPolicyReceipts();
      const calls: string[] = [];
      const policy = codexPolicy(p, store, checker((turnId) => simulate(store, binding, p.source, p.manifest.revision, BOTH, turnId), { listed, calls }));
      const prepared = data(await policy.prepare(launchRequest(tree)));
      const verified = await policy.verify(binding, prepared, { kind: "launch" });
      expect({ name, verified }).toMatchObject({ name, verified: { ok: false, error: { code: "not-ready", message: expect.stringContaining(why) } } });
      expect({ name, turns: calls.length }).toEqual({ name, turns: 0 });
    }
  });

  test("runs reported from the tree's own path never prove the main checkout's hooks", async () => {
    const p = project();
    const tree = linkedTree(p.root);
    const binding = bind("codex", THREAD, p.home);
    const store = createCodexPolicyReceipts();
    const policy = codexPolicy(p, store, checker(
      (turnId) => simulate(store, binding, join(tree, ".codex", "hooks.json"), p.manifest.revision, BOTH, turnId),
      { listed: ok(recordedListing(p.root, tree)) },
    ));
    const prepared = data(await policy.prepare(launchRequest(tree)));
    expect(await policy.verify(binding, prepared, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });
});

describe("old loaded worker cannot reuse new revision", () => {
  test("a proof for one revision never satisfies another", () => {
    const binding = bind("claude");
    data(recordPolicyProof(binding, installationProof(binding, "rev-A", ["continuation-policy"]), db));
    expect(requirePolicyProof(binding, ["continuation-policy"], "rev-A", db).ok).toBe(true);
    expect(requirePolicyProof(binding, ["continuation-policy"], "rev-B", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("receipts from a worker still running the old executable do not prove the new manifest", async () => {
    const p = project(EXE);
    const binding = bind("codex", THREAD, p.home);
    const oldRevision = codexPolicyManifest({ executable: OLD_EXE, installationId: INSTALLATION }).revision;
    const store = createCodexPolicyReceipts();
    const policy = codexPolicy(p, store, checker((turnId) => simulate(store, binding, p.source, oldRevision, BOTH, turnId)));
    const prepared = data(await policy.prepare(launchRequest(p.root)));
    expect(await policy.verify(binding, prepared, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("another hook revision") } });
  });

  test("work for a proven session is refused, and its readiness withdrawn, once its policy changes", async () => {
    let revision = "rev-1";
    const order: string[] = [];
    const policy: PolicyAdapter = {
      prepare: async () => { throw new Error("replaced"); },
      verify: async (b, prepared) => ok(installationProof(b, prepared.revision)),
    };
    const native: NativeSessionRef = { harness: "fake", profile: "default", kind: "id", value: "T9" };
    const launcher = launcherOf(fakeIntegration(fakeSessions(native, order), policy, { revision: () => revision }));
    const store = createSessionStore(db);
    const req = { reservationId: store.reserve({ identity: "w" }), cwd: "/w/a", mode: "headless" as Mode, selection: { harness: "fake", options: {} }, required: ["gate-policy"] as Capability[], access: { readRoots: [] } };
    const ready = data(await launcher.launchBoundAgent(req));
    revision = "rev-2";
    expect(await launcher.startBoundWork(ready, { id: "w1", text: "go" }, async () => ok(undefined))).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(order).not.toContain("work");
    expect(readBindingReadiness(db, ready.key)?.generation).toBeNull();
  });

  test("a resume never drops the policy requirement: verify gets the retained proof, and the agreed check only when asked", async () => {
    const contexts: Array<{ kind: string; retained?: number; check?: boolean }> = [];
    let resumeProven = false;
    const policy: PolicyAdapter = {
      prepare: async () => { throw new Error("replaced"); },
      async verify(b, prepared, context) {
        contexts.push({ kind: context?.kind ?? "none", ...(context?.retained && { retained: context.retained.generation }), ...(context?.check && { check: true }) });
        if (context?.kind === "resume" && !resumeProven) return { ok: false, error: { code: "not-ready", message: "no health since it resumed" } };
        return ok(installationProof(b, prepared.revision));
      },
    };
    const native: NativeSessionRef = { harness: "fake", profile: "default", kind: "id", value: "T5" };
    const launcher = launcherOf(fakeIntegration(fakeSessions(native), policy, { revision: () => "rev-1" }));
    const store = createSessionStore(db);
    const base = { cwd: "/w/a", mode: "headless" as Mode, selection: { harness: "fake", options: {} }, access: { readRoots: [] } };
    const first = data(await launcher.launchBoundAgent({ ...base, reservationId: store.reserve({ identity: "w5" }), required: ["gate-policy"] }));

    const resumed = await launcher.launchBoundAgent({ ...base, reservationId: store.reserve({ identity: "w5" }), required: [], resumeKey: first.key });
    expect(resumed).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(readBindingReadiness(db, first.key)).toMatchObject({ generation: 1, required: ["gate-policy"] });

    resumeProven = true;
    data(await launcher.launchBoundAgent({ ...base, reservationId: store.reserve({ identity: "w5" }), required: [], resumeKey: first.key, policyCheck: true }));
    expect(contexts).toEqual([{ kind: "launch" }, { kind: "resume", retained: 1 }, { kind: "resume", retained: 1, check: true }]);
    expect(readBindingReadiness(db, first.key)).toMatchObject({ generation: 3, required: ["gate-policy"], proof: { generation: 3 } });
  });

  test("a resumed Codex session without an agreed check is ready only when the same reservation is retried after its hooks ran under the new generation", async () => {
    const p = project();
    const receipts = createCodexPolicyReceipts();
    const checks: string[] = [];
    const real = createCodexPolicy({
      env: p.env, artifact: () => undefined, fingerprint: () => "rt 2.30.0", now: () => 7, receipts, sleep: async () => {},
      checker: async () => checker((turnId, b) => {
        checks.push(turnId);
        simulate(receipts, b, p.source, p.manifest.revision, BOTH, turnId);
      }),
    });
    const native: NativeSessionRef = { harness: "codex", profile: p.home, kind: "id", value: THREAD };
    const launcher = launcherOf(fakeIntegration(fakeSessions(native), real, { id: "codex", kind: "receipts" }));
    const store = createSessionStore(db);
    const base = { cwd: p.root, mode: "headless" as Mode, selection: { harness: "codex", options: {} }, access: { readRoots: [] } };
    const first = data(await launcher.launchBoundAgent({ ...base, reservationId: store.reserve({ identity: "wc" }), required: ["gate-policy", "continuation-policy"] }));
    expect(checks).toEqual([DIAG]);
    const resume = (reservationId: string): BoundLaunchRequest => ({ ...base, reservationId, required: [], resumeKey: first.key });
    const hooksRun = (turnId: string) => simulate(receipts, store.get(first.key)!, p.source, p.manifest.revision, BOTH, turnId);

    const r2 = store.reserve({ identity: "wc" });
    expect(await launcher.launchBoundAgent(resume(r2))).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("since it resumed") } });
    hooksRun("019a0000-0000-7000-8000-00000000f002");

    const r3 = store.reserve({ identity: "wc" });
    expect(await launcher.launchBoundAgent(resume(r3))).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(store.get(first.key)!.attachment.generation).toBe(3);
    hooksRun("019a0000-0000-7000-8000-00000000f003");
    const kept = data(await launcher.launchBoundAgent(resume(r3)));
    expect(kept.attachment.generation).toBe(3);
    expect(readBindingReadiness(db, first.key)).toMatchObject({ generation: 3, proof: { generation: 3, evidence: { turnId: DIAG, retainedFrom: 1 } } });

    const r4 = store.reserve({ identity: "wc" });
    expect((await launcher.launchBoundAgent(resume(r4))).ok).toBe(false);
    hooksRun("019a0000-0000-7000-8000-00000000f004");
    data(await launcher.launchBoundAgent(resume(r4)));
    expect(readBindingReadiness(db, first.key)).toMatchObject({ generation: 4, proof: { generation: 4, evidence: { turnId: DIAG, retainedFrom: 1 } } });
    expect(checks).toEqual([DIAG]);
  });

  test("a resumed session keeps a retained proof only while it is current and its hooks are seen running", async () => {
    const p = project();
    const binding = bind("codex", THREAD, p.home);
    const first = await proveCodex(p, binding);
    const retained = data(first.verified);
    const resumed = { ...binding, attachment: { ...binding.attachment, generation: binding.attachment.generation + 1 } };
    const store = createCodexPolicyReceipts();
    const calls: string[] = [];
    const policy = codexPolicy(p, store, checker(() => {}, { calls }));
    const prepared = data(await policy.prepare(launchRequest(p.root)));

    expect(await policy.verify(resumed, prepared, { kind: "resume" })).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(await policy.verify(resumed, prepared, { kind: "resume", retained: { ...retained, revision: "0".repeat(64) } }))
      .toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("changed") } });
    expect(await policy.verify(resumed, prepared, { kind: "resume", retained }))
      .toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("since it resumed") } });

    simulate(store, resumed, p.source, p.manifest.revision, BOTH, "019a0000-0000-7000-8000-00000000f00d");
    const kept = data(await policy.verify(resumed, prepared, { kind: "resume", retained }));
    expect(kept).toMatchObject({ sessionKey: binding.key, generation: resumed.attachment.generation, kind: "receipts", evidence: { retainedFrom: binding.attachment.generation } });
    expect(calls).toEqual([]);

    const unhealthy = createCodexPolicyReceipts();
    simulate(unhealthy, resumed, p.source, p.manifest.revision, [{ event: "PreToolUse" }, { event: "Stop", receipt: { verdict: "escaped" } }], "019a0000-0000-7000-8000-00000000f00e");
    expect(await codexPolicy(p, unhealthy, undefined).verify(resumed, prepared, { kind: "resume", retained })).toMatchObject({ ok: false, error: { code: "not-ready" } });

    const disagreeing = createCodexPolicyReceipts();
    simulate(disagreeing, resumed, p.source, p.manifest.revision, [{ event: "PreToolUse" }, { event: "Stop", run: { status: "blocked" } }], "019a0000-0000-7000-8000-00000000f00f");
    expect(await codexPolicy(p, disagreeing, undefined).verify(resumed, prepared, { kind: "resume", retained }))
      .toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("Stop") } });
  });
});

describe("switch off is exactly today", () => {
  test("with agent.integrations off nothing is enforced but the requirement is kept, so work after turning it back on is refused", async () => {
    let on = true;
    const calls = { prepare: 0, verify: 0 };
    const order: string[] = [];
    const policy: PolicyAdapter = {
      async prepare(req) {
        calls.prepare++;
        return ok({ id: "pp", harness: "fake", profile: "default", cwd: req.cwd, revision: "rev-1" });
      },
      async verify(b, prepared) {
        calls.verify++;
        return ok(installationProof(b, prepared.revision));
      },
    };
    const native: NativeSessionRef = { harness: "fake", profile: "default", kind: "id", value: "T6" };
    const launcher = launcherOf(fakeIntegration(fakeSessions(native, order), policy), () => on);
    const store = createSessionStore(db);
    const base = { cwd: "/w/a", mode: "headless" as Mode, selection: { harness: "fake", options: {} }, access: { readRoots: [] } };
    const first = data(await launcher.launchBoundAgent({ ...base, reservationId: store.reserve({ identity: "w6" }), required: ["gate-policy"] }));
    expect(calls).toEqual({ prepare: 1, verify: 1 });

    on = false;
    const resumed = data(await launcher.launchBoundAgent({ ...base, reservationId: store.reserve({ identity: "w6" }), required: [], resumeKey: first.key }));
    data(await launcher.startBoundWork(resumed, { id: "w1", text: "go" }, async () => ok(undefined)));
    expect(calls).toEqual({ prepare: 1, verify: 1 });
    expect(order).toEqual(["launch", "resume", "work"]);
    expect(readBindingReadiness(db, first.key)).toMatchObject({ generation: 2, required: ["gate-policy"], proof: { generation: 1 } });

    on = true;
    expect(await launcher.startBoundWork(resumed, { id: "w2", text: "go" }, async () => ok(undefined)))
      .toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("attachment 1") } });
    expect(order).toEqual(["launch", "resume", "work"]);
    expect(calls).toEqual({ prepare: 1, verify: 1 });
  });
});

describe("stale or forged proof refuses", () => {
  test("a proof for another session, generation or kind is never recorded or accepted", () => {
    const claude = bind("claude");
    const codex = bind("codex", "T-other");
    const base = installationProof(claude, "rev");
    expect(recordPolicyProof(claude, { ...base, sessionKey: codex.key }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(claude, { ...base, generation: 2 }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(claude, { ...base, verified: ["launch"] }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(claude, { ...base, kind: "receipts" }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(codex, { ...base, sessionKey: codex.key, kind: "installation" }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(requirePolicyProof(claude, [], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("a harness that declares no proof kind proves nothing", () => {
    const other = bind("other-harness");
    expect(recordPolicyProof(other, installationProof(other, "rev"), db)).toMatchObject({ ok: false, error: { code: "invalid", message: expect.stringContaining("does not know") } });
    expect(recordPolicyProof(other, installationProof(other, "rev"), db, "installation").ok).toBe(true);
    expect(requirePolicyProof(other, ["gate-policy"], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(requirePolicyProof(other, ["gate-policy"], "rev", db, "installation").ok).toBe(true);
  });

  test("a launch through an integration that declares no proof kind is not ready", async () => {
    const policy: PolicyAdapter = {
      prepare: async (req) => ok({ id: "pp", harness: "fake", profile: "default", cwd: req.cwd, revision: "rev-1" }),
      verify: async (b, prepared) => ok(installationProof(b, prepared.revision)),
    };
    const native: NativeSessionRef = { harness: "fake", profile: "default", kind: "id", value: "T8" };
    const launcher = launcherOf(fakeIntegration(fakeSessions(native), policy, { kind: null }));
    const req = { reservationId: createSessionStore(db).reserve({ identity: "w8" }), cwd: "/w/a", mode: "headless" as Mode, selection: { harness: "fake", options: {} }, required: ["gate-policy"] as Capability[], access: { readRoots: [] } };
    expect(await launcher.launchBoundAgent(req)).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("does not know") } });
  });

  test("a proof written behind the store's back for another session or attachment does not enable policy", () => {
    const claude = bind("claude");
    const other = bind("claude", "T-2");
    const write = (proof: unknown) => db.query("UPDATE agent_session_bindings SET proof = ? WHERE key = ?").run(JSON.stringify(proof), claude.key);
    write({ ...installationProof(claude, "rev"), sessionKey: other.key });
    expect(requirePolicyProof(claude, ["gate-policy"], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    write({ ...installationProof(claude, "rev"), generation: 7 });
    expect(requirePolicyProof(claude, ["gate-policy"], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    write(installationProof(claude, "rev", []));
    expect(requirePolicyProof(claude, ["gate-policy"], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("gate-policy") } });
  });

  test("a receipts proof needs its nonce and a native run for every event it claims", () => {
    const codex = bind("codex");
    const evidence = { turnId: DIAG, nonce: "6f1c2a8e-1b2c-4d5e-8f90-0a1b2c3d4e5f", sourcePath: "/p/.codex/hooks.json", manifest: "a".repeat(64), runs: { PreToolUse: "r1", Stop: "r2" } };
    const proof: PolicyProof = { sessionKey: codex.key, generation: 1, revision: "rev", verified: ["gate-policy", "continuation-policy"], observedAt: 1, kind: "receipts", evidence };
    expect(recordPolicyProof(codex, { ...proof, evidence: { ...evidence, nonce: "" } }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(codex, { ...proof, evidence: { ...evidence, runs: { PreToolUse: "r1", Stop: "" } } }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    const { evidence: _drop, ...bare } = proof;
    expect(recordPolicyProof(codex, bare, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    data(recordPolicyProof(codex, proof, db));
    expect(requirePolicyProof(codex, ["gate-policy", "continuation-policy"], "rev", db).ok).toBe(true);
  });

  test("a new attachment makes the old proof stale", () => {
    const binding = bind("claude");
    data(recordPolicyProof(binding, installationProof(binding, "rev", []), db));
    const moved = data(createSessionStore(db).replaceAttachment(binding.key, 1, { mode: "headless", pid: 4242 }));
    expect(requirePolicyProof(binding, [], "rev", db)).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(requirePolicyProof(moved, [], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("evidence from another diagnostic, another session, a forged receipt or a changed script never proves", async () => {
    const p = project();
    const binding = bind("codex", THREAD, p.home);
    const cases: Array<[string, (store: CodexPolicyReceipts, turnId: string) => void]> = [
      ["another check turn's nonce", (store) => simulate(store, binding, p.source, p.manifest.revision, BOTH, "019a0000-0000-7000-8000-0000000000aa")],
      ["another session", (store, turnId) => {
        const other = bind("codex", "019a0000-0000-7000-8000-0000000000bb", p.home);
        simulate(store, other, p.source, p.manifest.revision, BOTH, turnId);
      }],
      ["a forged shell receipt beside the real one", (store, turnId) => {
        simulate(store, binding, p.source, p.manifest.revision, BOTH, turnId);
        simulate(store, binding, p.source, p.manifest.revision, [{ event: "PreToolUse", receipt: { threadEnv: "same" }, run: false }], turnId);
      }],
      ["a foreign receipt with no thread env beside the real one", (store, turnId) => {
        simulate(store, binding, p.source, p.manifest.revision, BOTH, turnId);
        simulate(store, binding, p.source, p.manifest.revision, [{ event: "Stop", receipt: { threadEnv: "absent" }, run: false }], turnId);
      }],
      ["another installation", (store, turnId) => simulate(store, binding, p.source, p.manifest.revision, [
        { event: "PreToolUse", receipt: { installation: "inst-other" } }, { event: "Stop", receipt: { installation: "inst-other" } },
      ], turnId)],
      ["another hooks file", (store, turnId) => simulate(store, binding, p.source, p.manifest.revision, [
        { event: "PreToolUse", run: { sourcePath: "/elsewhere/.codex/hooks.json" } }, { event: "Stop", run: { sourcePath: "/elsewhere/.codex/hooks.json" } },
      ], turnId)],
    ];
    for (const [name, act] of cases) {
      const store = createCodexPolicyReceipts();
      const policy = codexPolicy(p, store, checker((turnId) => act(store, turnId)));
      const prepared = data(await policy.prepare(launchRequest(p.root)));
      const verified = await policy.verify(binding, prepared, { kind: "launch" });
      expect({ name, ok: verified.ok }).toEqual({ name, ok: false });
    }

    let bytes = "rt 2.30.0";
    const store = createCodexPolicyReceipts();
    const policy = codexPolicy(p, store, checker((turnId) => simulate(store, binding, p.source, p.manifest.revision, BOTH, turnId)), () => bytes);
    const prepared = data(await policy.prepare(launchRequest(p.root)));
    bytes = "rt 2.30.0 patched";
    expect(await policy.verify(binding, prepared, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("changed") } });
  });
});
