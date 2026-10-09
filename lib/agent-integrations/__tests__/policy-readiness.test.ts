import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type {
  Capability, CapabilityReport, Mode, NativeSessionRef, Outcome, SessionBinding,
} from "../../../packages/rt-client/src/agent-integrations.ts";
import { openStateDb } from "../../state/db.ts";
import { admitResourceRoots, checkUploadPath } from "../../daemon/upload-guard.ts";
import { cachedReadRoots, checkReadRootPath, checkTempRootPath, tempRootsForThisProcess } from "../../mcp/temp-root-guard.ts";
import { codexPolicyManifest } from "../codex/hook-manifest.ts";
import { createCodexPolicy, type CodexPolicyChecker } from "../codex/policy.ts";
import { createCodexPolicyReceipts, type CodexPolicyReceipts, type CodexReceiptInput } from "../codex/policy-receipts.ts";
import type {
  HarnessIntegration, LaunchRequest, PolicyAdapter, PolicyProof, PreparedPolicy, SessionAdapter,
} from "../contracts.ts";
import { createBoundLauncher } from "../launch.ts";
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
  return { root, source, home, manifest, env: { HOME: dir, CODEX_HOME: home } as NodeJS.ProcessEnv };
}

function launchRequest(cwd: string, over: Partial<LaunchRequest> = {}): LaunchRequest {
  return { reservationId: "res-1", cwd, mode: "headless", selection: { harness: "codex", options: {} }, required: [], access: { readRoots: [] }, ...over };
}

type Hook = { event: "PreToolUse" | "Stop"; receipt?: Partial<CodexReceiptInput> | false; run?: Record<string, unknown> | false };

/** What the bound session's hooks do during the check turn: each hook may receipt, and Codex may report its run. */
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
function checker(act: (turnId: string) => void, opts: { turnId?: string; issueAfter?: boolean; status?: string; calls?: string[] } = {}): CodexPolicyChecker {
  return {
    async policyCheck(_binding, run) {
      opts.calls?.push(run.prompt);
      const turnId = opts.turnId ?? DIAG;
      if (opts.issueAfter) act(turnId);
      run.issue(turnId);
      if (!opts.issueAfter) act(turnId);
      await run.settle();
      return ok({ turnId, status: opts.status ?? "completed" });
    },
  };
}

function codexPolicy(p: ReturnType<typeof project>, store: CodexPolicyReceipts, check: CodexPolicyChecker | undefined, fingerprint = () => "rt 2.30.0") {
  return createCodexPolicy({
    env: p.env, fingerprint, now: () => 7, receipts: store, checker: async () => check, sleep: async () => {},
  });
}

async function proveCodex(p: ReturnType<typeof project>, binding: SessionBinding, hooks: Hook[] = BOTH, opts: Parameters<typeof checker>[1] = {}) {
  const store = createCodexPolicyReceipts();
  const policy = codexPolicy(p, store, checker((turnId) => simulate(store, binding, p.source, p.manifest.revision, hooks, turnId), opts));
  const prepared = data(await policy.prepare(launchRequest(p.root)));
  return { store, policy, prepared, verified: await policy.verify(binding, prepared, { kind: "launch" }) };
}

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

  test("no live connection, a check turn that did not complete, or a policy service failure is not ready", async () => {
    const p = project();
    const binding = bind("codex", THREAD, p.home);
    const none = codexPolicy(p, createCodexPolicyReceipts(), undefined);
    const prepared = data(await none.prepare(launchRequest(p.root)));
    expect(await none.verify(binding, prepared, { kind: "launch" })).toMatchObject({ ok: false, error: { code: "not-ready" } });

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
    const sessions: SessionAdapter = {
      async launch(req) {
        order.push("launch");
        return ok({ native: { harness: "fake", profile: "default", kind: "id", value: "T1" }, attachment: { mode: req.mode } });
      },
      resume: async () => ({ ok: false, error: { code: "unsupported", message: "no" } }),
      discover: async () => [],
      observe: async (b) => ok({ connectivity: "unknown", execution: "unknown", background: "unknown", observedAt: 1, source: "none", generation: b.attachment.generation }),
      async startWork(b, input) {
        order.push("work");
        return ok({ id: input.id, evidence: "submitted", nativeId: b.native.value });
      },
    };
    const policy: PolicyAdapter = {
      prepare: async (req) => ok({ id: "pp", harness: "fake", profile: "default", cwd: req.cwd, revision: "rev-1" }),
      async verify(b, prepared) {
        order.push("verify");
        if (!proven) return { ok: false, error: { code: "not-ready", message: "the check turn produced no receipts" } };
        return ok({ sessionKey: b.key, generation: b.attachment.generation, revision: prepared.revision, verified: ["gate-policy"], observedAt: 1 });
      },
    };
    const integration = fakeIntegration(sessions, policy);
    const launcher = createBoundLauncher({ db, registry: createRegistry([integration]), claimToken: "proc-A" });
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
});

function fakeIntegration(sessions: SessionAdapter, policy: PolicyAdapter, revision?: () => string): HarnessIntegration {
  const wrapped: PolicyAdapter = revision
    ? { ...policy, prepare: async (req) => ok({ id: "pp", harness: "fake", profile: "default", cwd: req.cwd, revision: revision() }) }
    : policy;
  return {
    id: "fake", label: "fake",
    capabilities: async (mode: Mode): Promise<CapabilityReport> => ({ mode, supported: ["launch", "resume", "observe", "gate-policy"], readiness: { ready: true } }),
    validateOptions: (options: object) => ok(options),
    options: async () => [],
    loadSessions: async () => sessions,
    loadPolicy: async () => wrapped,
  } as unknown as HarnessIntegration;
}

describe("old loaded worker cannot reuse new revision", () => {
  test("a proof for one revision never satisfies another", () => {
    const binding = bind("claude");
    const proof: PolicyProof = { sessionKey: binding.key, generation: 1, revision: "rev-A", verified: ["continuation-policy"], observedAt: 1, kind: "installation" };
    data(recordPolicyProof(binding, proof, db));
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
    const sent: string[] = [];
    const sessions: SessionAdapter = {
      launch: async (req) => ok({ native: { harness: "fake", profile: "default", kind: "id", value: "T9" }, attachment: { mode: req.mode } }),
      resume: async () => ({ ok: false, error: { code: "unsupported", message: "no" } }),
      discover: async () => [],
      observe: async (b) => ok({ connectivity: "unknown", execution: "unknown", background: "unknown", observedAt: 1, source: "none", generation: b.attachment.generation }),
      async startWork(b, input) {
        sent.push(input.id);
        return ok({ id: input.id, evidence: "submitted", nativeId: b.native.value });
      },
    };
    const policy: PolicyAdapter = {
      prepare: async () => { throw new Error("replaced"); },
      verify: async (b, prepared) => ok({ sessionKey: b.key, generation: b.attachment.generation, revision: prepared.revision, verified: ["gate-policy"], observedAt: 1 }),
    };
    const launcher = createBoundLauncher({ db, registry: createRegistry([fakeIntegration(sessions, policy, () => revision)]), claimToken: "proc-A" });
    const store = createSessionStore(db);
    const req = { reservationId: store.reserve({ identity: "w" }), cwd: "/w/a", mode: "headless" as Mode, selection: { harness: "fake", options: {} }, required: ["gate-policy"] as Capability[], access: { readRoots: [] } };
    const ready = data(await launcher.launchBoundAgent(req));
    revision = "rev-2";
    expect(await launcher.startBoundWork(ready, { id: "w1", text: "go" }, async () => ok(undefined))).toMatchObject({ ok: false, error: { code: "not-ready" } });
    expect(sent).toEqual([]);
    expect(readBindingReadiness(db, ready.key)?.generation).toBeNull();
  });

  test("a resume never drops the policy requirement: verify gets the retained proof, and the agreed check only when asked", async () => {
    const contexts: Array<{ kind: string; retained?: number; check?: boolean }> = [];
    let resumeProven = false;
    const sessions: SessionAdapter = {
      launch: async (req) => ok({ native: { harness: "fake", profile: "default", kind: "id", value: "T5" }, attachment: { mode: req.mode } }),
      resume: async (ref, req) => ok({ native: ref, attachment: { mode: req.mode } }),
      discover: async () => [],
      observe: async (b) => ok({ connectivity: "unknown", execution: "unknown", background: "unknown", observedAt: 1, source: "none", generation: b.attachment.generation }),
      startWork: async (b, input) => ok({ id: input.id, evidence: "submitted", nativeId: b.native.value }),
    };
    const policy: PolicyAdapter = {
      prepare: async () => { throw new Error("replaced"); },
      async verify(b, prepared, context) {
        contexts.push({ kind: context?.kind ?? "none", ...(context?.retained && { retained: context.retained.generation }), ...(context?.check && { check: true }) });
        if (context?.kind === "resume" && !resumeProven) return { ok: false, error: { code: "not-ready", message: "no health since it resumed" } };
        return ok({ sessionKey: b.key, generation: b.attachment.generation, revision: prepared.revision, verified: ["gate-policy"], observedAt: 1 });
      },
    };
    const launcher = createBoundLauncher({ db, registry: createRegistry([fakeIntegration(sessions, policy, () => "rev-1")]), claimToken: "proc-A" });
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
    const sick = codexPolicy(p, unhealthy, undefined);
    expect(await sick.verify(resumed, prepared, { kind: "resume", retained })).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });
});

describe("stale or forged proof refuses", () => {
  test("a proof for another session, generation or kind is never recorded or accepted", () => {
    const claude = bind("claude");
    const codex = bind("codex", "T-other");
    const base: PolicyProof = { sessionKey: claude.key, generation: 1, revision: "rev", verified: ["gate-policy"], observedAt: 1, kind: "installation" };
    expect(recordPolicyProof(claude, { ...base, sessionKey: codex.key }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(claude, { ...base, generation: 2 }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(claude, { ...base, verified: ["launch"] }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(claude, { ...base, kind: "receipts" }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(recordPolicyProof(codex, { ...base, sessionKey: codex.key, kind: "installation" }, db)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(requirePolicyProof(claude, [], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("a proof written behind the store's back for another session or attachment does not enable policy", () => {
    const claude = bind("claude");
    const other = bind("claude", "T-2");
    const write = (proof: unknown) => db.query("UPDATE agent_session_bindings SET proof = ? WHERE key = ?").run(JSON.stringify(proof), claude.key);
    write({ sessionKey: other.key, generation: 1, revision: "rev", verified: ["gate-policy"], observedAt: 1, kind: "installation" });
    expect(requirePolicyProof(claude, ["gate-policy"], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    write({ sessionKey: claude.key, generation: 7, revision: "rev", verified: ["gate-policy"], observedAt: 1, kind: "installation" });
    expect(requirePolicyProof(claude, ["gate-policy"], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
    write({ sessionKey: claude.key, generation: 1, revision: "rev", verified: [], observedAt: 1, kind: "installation" });
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
    data(recordPolicyProof(binding, { sessionKey: binding.key, generation: 1, revision: "rev", verified: [], observedAt: 1, kind: "installation" }, db));
    const moved = data(createSessionStore(db).replaceAttachment(binding.key, 1, { mode: "headless", pid: 4242 }));
    expect(requirePolicyProof(binding, [], "rev", db)).toMatchObject({ ok: false, error: { code: "stale-binding" } });
    expect(requirePolicyProof(moved, [], "rev", db)).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });

  test("evidence from another diagnostic, another session, a forged shell receipt or a changed script never proves", async () => {
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

describe("foreign temporary path remains refused", () => {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;

  function roots() {
    const owned = join(dir, "owned-root");
    const foreign = join(dir, "foreign");
    mkdirSync(owned, { recursive: true });
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "secret.md"), "# not yours\n");
    return { owned, foreign };
  }

  test("only a real, owned, narrow directory is admitted as an integration root", () => {
    const { owned } = roots();
    const link = join(dir, "link-root");
    symlinkSync(owned, link);
    const home = join(dir, "home");
    mkdirSync(home);
    const opts = { uid, home };
    expect(admitResourceRoots([owned], opts)).toEqual([owned]);
    expect(admitResourceRoots([link, home, dir, "/", "/tmp", "/private/tmp", realpathSync(tmpdir()), "relative/root", `${owned}/../owned-root`, `${owned}/`, 7, ""], opts)).toEqual([]);
    expect(admitResourceRoots([join(dir, "missing")], opts)).toEqual([]);
    expect(admitResourceRoots([owned], { uid: (uid ?? 0) + 1, home })).toEqual([]);
    expect(admitResourceRoots([owned], { uid: null, home })).toEqual([]);
  });

  test("an admitted temp root confines writes: foreign, traversal and symlink escapes stay refused", () => {
    const { owned, foreign } = roots();
    const temp = tempRootsForThisProcess([owned], { home: join(dir, "home") });
    expect(temp).toContain(owned);
    expect(tempRootsForThisProcess([join(dir, "nope"), dir], { home: join(dir, "home") })).toEqual(tempRootsForThisProcess());
    expect(checkTempRootPath(join(owned, "brief.md"), temp)).toEqual({ ok: true });
    expect(checkTempRootPath(join(foreign, "brief.md"), temp).ok).toBe(false);
    expect(checkTempRootPath(`${owned}/../foreign/brief.md`, temp).ok).toBe(false);
    symlinkSync(foreign, join(owned, "escape"));
    expect(checkTempRootPath(join(owned, "escape", "brief.md"), temp).ok).toBe(false);
  });

  test("an admitted resource root confines reads, and an unadmitted one adds nothing", () => {
    const { owned, foreign } = roots();
    writeFileSync(join(owned, "skill.md"), "# skill\n");
    symlinkSync(join(foreign, "secret.md"), join(owned, "linked.md"));
    const read = cachedReadRoots({
      tempRoots: () => [], pluginRoots: () => [], packRoots: () => [], now: () => 1,
      resourceRoots: () => [owned, foreign + "/../foreign", join(dir, "link-to-foreign")],
    }, 0, { uid, home: join(dir, "home") })();
    expect(read.roots).toEqual([owned]);
    expect(checkReadRootPath(join(owned, "skill.md"), read.roots).ok).toBe(true);
    expect(checkReadRootPath(join(foreign, "secret.md"), read.roots).ok).toBe(false);
    expect(checkReadRootPath(join(owned, "linked.md"), read.roots).ok).toBe(false);
    expect(checkReadRootPath(`${owned}/../foreign/secret.md`, read.roots).ok).toBe(false);
  });

  test("uploads through an admitted root still refuse a symlink out of it", () => {
    const { owned, foreign } = roots();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    writeFileSync(join(foreign, "shot.png"), png);
    writeFileSync(join(owned, "shot.png"), png);
    symlinkSync(join(foreign, "shot.png"), join(owned, "linked.png"));
    const admitted = admitResourceRoots([owned], { uid, home: join(dir, "home") });
    const opts = { workRoot: join(dir, "work"), runsRoot: join(dir, "runs"), evidenceRoot: join(dir, "evidence") };
    expect(checkUploadPath(join(owned, "shot.png"), admitted, opts).ok).toBe(true);
    expect(checkUploadPath(join(owned, "linked.png"), admitted, opts).ok).toBe(false);
    expect(checkUploadPath(join(foreign, "shot.png"), admitted, opts).ok).toBe(false);
    expect(dirname(owned)).toBe(dir);
  });
});
