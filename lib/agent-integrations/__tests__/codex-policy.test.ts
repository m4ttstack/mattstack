import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type { CallerContext, NativeSessionRef, Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { createGatesStore } from "../../daemon/gates-store.ts";
import { createAgentIntegrationHandlers } from "../../daemon/handlers/agent-integrations.ts";
import { insertAgent } from "../../state/agents-store.ts";
import { openStateDb } from "../../state/db.ts";
import { bindingGateSubject, resolveCallerContextNow } from "../context.ts";
import {
  CODEX_POLICY_HOOK_TIMEOUT_SECONDS, codexPolicyHookCommand, codexPolicyManifest, parseCodexPolicyHookCommand,
} from "../codex/hook-manifest.ts";
import {
  CODEX_FEEDBACK_LIMIT, CODEX_HOOK_PASS, CODEX_PROVEN_POLICY, STOP_CONTINUATION_CAP, createCodexPolicy, fileStopCounter,
  handleCodexHook, parseCodexHook, type CodexHookDeps, type StopCounter,
} from "../codex/policy.ts";
import {
  acceptCodexPolicyReceipt, checkReceiptPayload, createCodexPolicyReceipts, type ReceiptPayload,
} from "../codex/policy-receipts.ts";
import { codexSupported } from "../codex/sessions.ts";
import { createGateQuestions } from "../questions.ts";
import { createSessionStore } from "../session-store.ts";
import { stopReason, type ForkCheckPayload, type ForkCheckResponse } from "../policy.ts";
import type { LaunchRequest } from "../contracts.ts";

const THREAD = "019a0000-0000-7000-8000-000000000001";
const OTHER_THREAD = "019a0000-0000-7000-8000-0000000000ff";
const TURN = "019a0000-0000-7000-8000-00000000a001";
const EXE = "/opt/mattstack/2.30.0/Contents/Helpers/rt";
const INSTALLATION = "inst-test-1";

let dir = "";
let db: Database;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-codex-policy-")));
  db = openStateDb(join(dir, "state.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const codex = (value: string, profile = "default"): NativeSessionRef => ({ harness: "codex", profile, kind: "id", value });

function bindAgent(thread = THREAD, opts: { agentId?: string; subject?: string; pane?: string; profile?: string } = {}) {
  const agentId = opts.agentId ?? "ag-codex1";
  insertAgent({
    id: agentId, repo: "remote:example.com%2Fa%2Fb", cwd: "/w", provider: "codex", surface: "herdr", sessionId: thread, createdAt: 1,
    ...(opts.subject !== undefined && { subject: opts.subject }),
  }, db);
  const store = createSessionStore(db);
  const bound = store.bind(store.reserve({ identity: `agent:${agentId}`, agentId }), codex(thread, opts.profile), { mode: "herdr", pane: opts.pane ?? "w1:p1" });
  if (!bound.ok) throw new Error(bound.error.message);
  return bound.data;
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: THREAD, turn_id: TURN, cwd: dir, hook_event_name: "PreToolUse", model: "test-model",
    permission_mode: "bypassPermissions", tool_name: "request_user_input", tool_input: { questions: [] }, ...over,
  };
}
const stopPayload = (over: Record<string, unknown> = {}) =>
  payload({ hook_event_name: "Stop", tool_name: undefined, tool_input: undefined, stop_hook_active: false, last_assistant_message: "DONE", ...over });

function memoryStops(): StopCounter & { counts: Map<string, { turnId: string; count: number }> } {
  const counts = new Map<string, { turnId: string; count: number }>();
  return {
    counts,
    bump(threadId, turnId) {
      const held = counts.get(threadId);
      const count = held && held.turnId === turnId ? held.count + 1 : 1;
      counts.set(threadId, { turnId, count });
      return count;
    },
    clear(threadId) {
      counts.delete(threadId);
    },
  };
}

type Spies = {
  forkChecks: ForkCheckPayload[]; receipts: ReceiptPayload[]; resolved: NativeSessionRef[];
  unavailable: string[]; finds: string[]; logs: string[];
};

function harness(over: Partial<CodexHookDeps> & { fork?: ForkCheckResponse | (() => never); snapshots?: Record<string, unknown>; findThrows?: boolean } = {}) {
  const spies: Spies = { forkChecks: [], receipts: [], resolved: [], unavailable: [], finds: [], logs: [] };
  const stops = memoryStops();
  const snapshots = over.snapshots ?? {};
  const deps: CodexHookDeps = {
    event: over.event,
    installation: INSTALLATION,
    executable: EXE,
    env: {},
    enabled: () => true,
    resolve: (native) => {
      spies.resolved.push(native);
      return resolveCallerContextNow({ native }, { db });
    },
    subjectOf: (binding) => bindingGateSubject(binding, db),
    stops,
    receipt: async (p) => {
      spies.receipts.push(p);
      return { ok: true, data: { turn: "current", diagnostic: false } };
    },
    log: (message) => { spies.logs.push(message); },
    policy: {
      forkCheck: async (p) => {
        spies.forkChecks.push(p);
        if (typeof over.fork === "function") over.fork();
        return "fork" in over ? over.fork as ForkCheckResponse : { ok: true, data: { allow: true, match: "subject" } };
      },
      findRunning: (session) => {
        spies.finds.push(session);
        if (over.findThrows) throw new Error("runs root unreadable");
        return Object.keys(snapshots);
      },
      snapshot: (runDb) => snapshots[runDb],
      onUnavailable: (_context, action, message) => { spies.unavailable.push(`${action}: ${message}`); },
    },
    ...Object.fromEntries(Object.entries(over).filter(([k]) => !["fork", "snapshots", "findThrows"].includes(k))),
  };
  return { deps, spies, stops };
}

/** A running run this thread owns; ownership is still the claude-session field until runs record a harness-neutral owner. */
function ownedRun(id: string, fields: Array<{ key: string; value: string; at: number }> = [], owner = THREAD) {
  return {
    ok: true,
    run: { id, repo: "repo-a", status: "running", current_stage: "ship", started_at: 1000 },
    stages: [{ name: "plan", started_at: 1000, status: "done", attempt: 1 }, { name: "ship", started_at: 2000, status: "running", attempt: 1 }],
    fields: [{ key: "claude-session", value: owner, at: 1000, produced_by: "work" }, ...fields.map((f) => ({ ...f, produced_by: "work" }))],
    decisions: [],
  };
}

// ─── Manifest ────────────────────────────────────────────────────────────────

describe("codexPolicyManifest", () => {
  test("installs PreToolUse and Stop as fixed absolute versioned commands", () => {
    const manifest = codexPolicyManifest({ executable: EXE, installationId: INSTALLATION });
    expect(Object.keys(manifest.hooks)).toEqual(["PreToolUse", "Stop"]);
    expect(manifest.hooks.PreToolUse).toEqual([{
      hooks: [{ type: "command", command: `'${EXE}' agent policy-hook --installation '${INSTALLATION}' --event 'PreToolUse'`, timeout: CODEX_POLICY_HOOK_TIMEOUT_SECONDS }],
    }]);
    expect(manifest.hooks.Stop[0]!.hooks[0]!.command).toBe(`'${EXE}' agent policy-hook --installation '${INSTALLATION}' --event 'Stop'`);
    expect(manifest.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(codexPolicyManifest({ executable: EXE, installationId: INSTALLATION }).revision).toBe(manifest.revision);
    expect(codexPolicyManifest({ executable: "/opt/mattstack/2.31.0/Contents/Helpers/rt", installationId: INSTALLATION }).revision).not.toBe(manifest.revision);
    expect(codexPolicyManifest({ executable: EXE, installationId: "inst-test-2" }).revision).not.toBe(manifest.revision);
  });

  test("refuses a relative executable or an installation id a shell could misread", () => {
    expect(() => codexPolicyManifest({ executable: "rt", installationId: INSTALLATION })).toThrow();
    expect(() => codexPolicyManifest({ executable: "/opt/rt\nevil", installationId: INSTALLATION })).toThrow();
    expect(() => codexPolicyManifest({ executable: EXE, installationId: "a'; rm -rf /" })).toThrow();
    expect(() => codexPolicyManifest({ executable: EXE, installationId: "" })).toThrow();
  });

  test("a command parses back only when it is exactly the manifest's spelling", () => {
    const quoted = "/opt/it's here/rt";
    const command = codexPolicyHookCommand(quoted, INSTALLATION, "Stop");
    expect(parseCodexPolicyHookCommand(command)).toEqual({ executable: quoted, installationId: INSTALLATION, event: "Stop" });
    expect(parseCodexPolicyHookCommand(`${command} --extra`)).toBeNull();
    expect(parseCodexPolicyHookCommand(`'${EXE}' agent policy-hook --installation '${INSTALLATION}' --event 'Notify'`)).toBeNull();
    expect(parseCodexPolicyHookCommand(`${EXE} agent policy-hook --installation ${INSTALLATION} --event Stop`)).toBeNull();
  });
});

// ─── Translation ─────────────────────────────────────────────────────────────

describe("handleCodexHook", () => {
  test("native IDs resolve exact binding", async () => {
    bindAgent(THREAD, { subject: "herd:h1/job-a", pane: "w2:p3" });
    bindAgent(OTHER_THREAD, { agentId: "ag-other", subject: "herd:h1/job-b", pane: "w9:p9" });
    const { deps, spies } = harness({ event: "PreToolUse" });

    expect(await handleCodexHook(payload(), deps)).toEqual(CODEX_HOOK_PASS);
    expect(spies.resolved).toEqual([codex(THREAD)]);
    expect(spies.forkChecks).toEqual([{ subject: "herd:h1/job-a", sessionIds: [THREAD], paneId: "w2:p3", worktrees: [dir] }]);
    const revision = codexPolicyManifest({ executable: EXE, installationId: INSTALLATION }).revision;
    expect(spies.receipts).toEqual([{
      installation: INSTALLATION, revision, profile: "default", event: "PreToolUse", tool: "request_user_input",
      sessionId: THREAD, turnId: TURN, verdict: "allow",
    }]);

    // Another profile's home names another thread store, so the same id is not this binding.
    const elsewhere = harness({ event: "PreToolUse", env: { CODEX_HOME: join(dir, "other-home") } });
    expect(await handleCodexHook(payload(), elsewhere.deps)).toEqual(CODEX_HOOK_PASS);
    expect(elsewhere.spies.resolved).toEqual([codex(THREAD, join(dir, "other-home"))]);
    expect(elsewhere.spies.forkChecks).toEqual([]);
    expect(elsewhere.spies.receipts).toEqual([]);

    // The process's own thread variable must agree with the payload's thread.
    const crossed = harness({ event: "PreToolUse", env: { CODEX_THREAD_ID: OTHER_THREAD } });
    expect(await handleCodexHook(payload(), crossed.deps)).toEqual(CODEX_HOOK_PASS);
    expect(crossed.spies.resolved).toEqual([]);

    // A pane or job in the environment never names a binding.
    const unbound = harness({ event: "PreToolUse", env: { HERDR_PANE_ID: "w2:p3", HERD_ID: "h1", HERD_JOB: "job-a" } });
    expect(await handleCodexHook(payload({ session_id: "019a0000-0000-7000-8000-0000000000aa" }), unbound.deps)).toEqual(CODEX_HOOK_PASS);
    expect(unbound.spies.forkChecks).toEqual([]);
    expect(unbound.spies.receipts).toEqual([]);
  });

  test("a detached binding is no longer the caller", async () => {
    const bound = bindAgent(THREAD, { subject: "herd:h1/job-a" });
    expect(createSessionStore(db).detach(bound.key, bound.attachment.generation).ok).toBe(true);
    const { deps, spies } = harness({ fork: { ok: true, data: { allow: false } } });
    expect(await handleCodexHook(payload(), deps)).toEqual(CODEX_HOOK_PASS);
    expect(spies.forkChecks).toEqual([]);
  });

  test("refused question exits two", async () => {
    bindAgent(THREAD, { subject: "run:r1" });
    const { deps, spies } = harness({ event: "PreToolUse", fork: { ok: true, data: { allow: false, subject: "run:r1" } } });
    for (let i = 0; i < 3; i++) {
      const result = await handleCodexHook(payload(), deps);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("rt gate ask");
      expect(result.stderr).toContain("request_user_input");
      expect(result.stderr).not.toContain("AskUserQuestion");
      expect(result.stderr).toContain(JSON.stringify("run:r1"));
      expect(result.stderr.length).toBeLessThanOrEqual(CODEX_FEEDBACK_LIMIT);
    }
    expect(spies.receipts.map((r) => r.verdict)).toEqual(["refused", "refused", "refused"]);
    expect(spies.unavailable).toEqual([]);
  });

  test("an unbound launch or an unavailable gate service lets the question through and says so", async () => {
    const unbound = createSessionStore(db);
    const plain = unbound.bind(unbound.reserve({ identity: "remy.ab12" }), codex(THREAD), { mode: "herdr", pane: "w1:p1" });
    expect(plain.ok).toBe(true);
    const noLaunch = harness();
    expect(await handleCodexHook(payload(), noLaunch.deps)).toEqual(CODEX_HOOK_PASS);
    expect(noLaunch.spies.forkChecks).toEqual([]);
    expect(noLaunch.spies.receipts.map((r) => r.verdict)).toEqual(["allow"]);

    bindAgent(OTHER_THREAD, { subject: "run:r1" });
    const down = harness({ fork: null });
    expect(await handleCodexHook(payload({ session_id: OTHER_THREAD }), down.deps)).toEqual(CODEX_HOOK_PASS);
    expect(down.spies.unavailable).toEqual(["ask: the gate service gave no verdict"]);
    expect(down.spies.receipts).toEqual([expect.objectContaining({ verdict: "unavailable", detail: "the gate service gave no verdict" })]);
  });

  test("stop delegates running hold and wait decisions", async () => {
    bindAgent(THREAD, { subject: "run:r1" });
    const cases: Array<{ name: string; snapshots: Record<string, unknown>; want: "continue" | "allow" }> = [
      { name: "no owned run", snapshots: {}, want: "allow" },
      { name: "running open stage", snapshots: { "/runs/a/r-open/state.db": ownedRun("r-open") }, want: "continue" },
      { name: "current hold", snapshots: { "/runs/a/r-held/state.db": ownedRun("r-held", [{ key: "hold", value: "parked", at: 3000 }]) }, want: "allow" },
      { name: "armed gate wait", snapshots: { "/runs/a/r-wait/state.db": ownedRun("r-wait", [{ key: "waiting-gate", value: "g-17", at: 3000 }]) }, want: "allow" },
      { name: "another session's run", snapshots: { "/runs/a/r-x/state.db": ownedRun("r-x", [], OTHER_THREAD) }, want: "allow" },
    ];
    for (const c of cases) {
      const { deps, spies } = harness({ event: "Stop", snapshots: c.snapshots });
      const result = await handleCodexHook(stopPayload(), deps);
      if (c.want === "continue") {
        expect(result).toEqual({ exitCode: 2, stdout: "", stderr: stopReason("r-open", "ship") });
      } else {
        expect(result).toEqual(CODEX_HOOK_PASS);
      }
      expect(spies.finds).toEqual([THREAD]);
      expect(spies.forkChecks).toEqual([]);
      expect(spies.receipts).toEqual([expect.objectContaining({ event: "Stop", verdict: c.want, sessionId: THREAD, turnId: TURN })]);
      expect(spies.receipts[0]).not.toHaveProperty("tool");
    }

    const broken = harness({ event: "Stop", findThrows: true });
    expect(await handleCodexHook(stopPayload(), broken.deps)).toEqual(CODEX_HOOK_PASS);
    expect(broken.spies.unavailable).toEqual(["stop: the session's runs could not be read: runs root unreadable"]);
    expect(broken.spies.receipts).toEqual([expect.objectContaining({ verdict: "unavailable" })]);
  });

  test("repeated continuations are capped per turn as Claude Code caps its Stop blocks", async () => {
    bindAgent(THREAD);
    const snapshots = { "/runs/a/r-open/state.db": ownedRun("r-open") };
    const { deps, spies, stops } = harness({ event: "Stop", snapshots });
    const exits: number[] = [];
    for (let i = 0; i < STOP_CONTINUATION_CAP + 2; i++) exits.push((await handleCodexHook(stopPayload({ stop_hook_active: i > 0 }), deps)).exitCode);
    expect(exits).toEqual([...Array(STOP_CONTINUATION_CAP).fill(2), 0, 0]);
    expect(spies.receipts.map((r) => r.verdict).slice(-3)).toEqual(["continue", "escaped", "escaped"]);
    expect(spies.logs.filter((l) => l.includes("let through after repeated continuations"))).toHaveLength(2);

    expect((await handleCodexHook(stopPayload({ turn_id: "019a0000-0000-7000-8000-00000000a002" }), deps)).exitCode).toBe(2);
    expect(stops.counts.get(THREAD)).toEqual({ turnId: "019a0000-0000-7000-8000-00000000a002", count: 1 });

    const settled = harness({ event: "Stop", stops, snapshots: {} });
    expect(await handleCodexHook(stopPayload(), settled.deps)).toEqual(CODEX_HOOK_PASS);
    expect(stops.counts.has(THREAD)).toBe(false);
  });

  test("the file counter counts per thread and turn and escapes when it cannot write", () => {
    const counter = fileStopCounter(join(dir, "stops"));
    expect([counter.bump("t1", "u1"), counter.bump("t1", "u1"), counter.bump("t2", "u1"), counter.bump("t1", "u2")]).toEqual([1, 2, 1, 1]);
    counter.clear("t1");
    expect(counter.bump("t1", "u2")).toBe(1);
    expect(readdirSync(join(dir, "stops")).every((f) => /^[0-9a-f]{32}\.json$/.test(f))).toBe(true);
    writeFileSync(join(dir, "blocked"), "a file, not a directory");
    expect(fileStopCounter(join(dir, "blocked", "stops")).bump("t1", "u1")).toBe(Number.POSITIVE_INFINITY);
  });

  test("malformed or foreign hook cannot mutate state", async () => {
    bindAgent(THREAD, { subject: "run:r1" });
    const inputs: Array<[string, unknown, CodexHookDeps["event"]?]> = [
      ["no payload", undefined],
      ["not an object", "session_id=x"],
      ["an array", [payload()]],
      ["no turn", payload({ turn_id: undefined })],
      ["an empty session", payload({ session_id: "" })],
      ["a control character in the session", payload({ session_id: `${THREAD}\n` })],
      ["a relative cwd", payload({ cwd: "work" })],
      ["an event no definition names", payload({ hook_event_name: "SessionStart" })],
      ["a Stop payload sent to the PreToolUse definition", stopPayload(), "PreToolUse"],
      ["a PreToolUse payload sent to the Stop definition", payload(), "Stop"],
      ["no tool name", payload({ tool_name: undefined })],
      ["another tool", payload({ tool_name: "shell", tool_input: { command: ["rt", "gate", "answer"] } })],
    ];
    for (const [name, input, event] of inputs) {
      const { deps, spies, stops } = harness({ event, fork: { ok: true, data: { allow: false } }, snapshots: { "/runs/a/r-open/state.db": ownedRun("r-open") } });
      const result = await handleCodexHook(input, deps);
      expect({ name, result }).toEqual({ name, result: CODEX_HOOK_PASS });
      expect({ name, spies: { ...spies, logs: [] } }).toEqual({ name, spies: { forkChecks: [], receipts: [], resolved: [], unavailable: [], finds: [], logs: [] } });
      expect(stops.counts.size).toBe(0);
    }

    const off = harness({ enabled: () => false, fork: { ok: true, data: { allow: false } } });
    expect(await handleCodexHook(payload(), off.deps)).toEqual(CODEX_HOOK_PASS);
    expect(off.spies.resolved).toEqual([]);
  });

  test("a hook that throws passes rather than trapping the session", async () => {
    bindAgent(THREAD, { subject: "run:r1" });
    const { deps, spies } = harness({ resolve: () => { throw new Error("state db locked"); } });
    expect(await handleCodexHook(payload(), deps)).toEqual(CODEX_HOOK_PASS);
    expect(spies.logs).toEqual(["a Codex policy hook failed, so it decided nothing"]);
  });
});

// ─── Receipts ────────────────────────────────────────────────────────────────

describe("policy receipts", () => {
  const revision = codexPolicyManifest({ executable: EXE, installationId: INSTALLATION }).revision;
  const receipt = (over: Partial<ReceiptPayload> = {}): ReceiptPayload => ({
    installation: INSTALLATION, revision, profile: "default", event: "Stop", sessionId: THREAD, turnId: TURN, verdict: "continue", ...over,
  });
  const resolve = (native: NativeSessionRef): Outcome<CallerContext> => resolveCallerContextNow({ native }, { db });

  test("record the daemon's own binding and turn match, and a nonce only for the issued diagnostic turn", async () => {
    const bound = bindAgent(THREAD);
    const store = createCodexPolicyReceipts(() => 42);
    const deps = { enabled: () => true, resolve, store, activeTurn: () => TURN, attention: () => { throw new Error("no attention expected"); } };

    expect(await acceptCodexPolicyReceipt(receipt(), deps)).toEqual({ ok: true, data: { turn: "current", diagnostic: false } });
    const nonce = store.issueDiagnostic(bound.key, bound.attachment.generation, "019a0000-0000-7000-8000-00000000d1a6");
    expect(await acceptCodexPolicyReceipt(receipt({ turnId: "019a0000-0000-7000-8000-00000000d1a6" }), { ...deps, activeTurn: () => undefined }))
      .toEqual({ ok: true, data: { turn: "unknown", diagnostic: true } });
    expect(await acceptCodexPolicyReceipt(receipt(), { ...deps, activeTurn: () => "019a0000-0000-7000-8000-00000000beef" }))
      .toEqual({ ok: true, data: { turn: "other", diagnostic: false } });

    const held = store.list(bound.key, bound.attachment.generation);
    expect(held.map((r) => [r.turn, r.nonce])).toEqual([["current", undefined], ["unknown", nonce], ["other", undefined]]);
    expect(held[0]).toEqual({
      sessionKey: bound.key, generation: bound.attachment.generation, threadId: THREAD, turnId: TURN, event: "Stop",
      verdict: "continue", installation: INSTALLATION, revision, turn: "current", at: 42,
    });
    expect(store.list(bound.key, bound.attachment.generation + 1)).toEqual([]);
  });

  test("a receipt cannot name a binding, carry a nonce, or record for an unbound thread", async () => {
    bindAgent(THREAD);
    const store = createCodexPolicyReceipts();
    const deps = { enabled: () => true, resolve, store, activeTurn: () => undefined, attention: () => {} };
    expect(checkReceiptPayload({ ...receipt(), sessionKey: "key-x" })).toEqual({ ok: false, error: { code: "invalid", message: "a receipt has no sessionKey field" } });
    expect(checkReceiptPayload({ ...receipt(), nonce: "n" }).ok).toBe(false);
    expect(checkReceiptPayload(receipt({ revision: "abc" })).ok).toBe(false);
    expect(checkReceiptPayload(receipt({ installation: "../x" })).ok).toBe(false);
    expect(checkReceiptPayload(receipt({ verdict: "answered" as ReceiptPayload["verdict"] })).ok).toBe(false);
    expect(checkReceiptPayload(receipt({ turnId: "" })).ok).toBe(false);

    const stranger = await acceptCodexPolicyReceipt(receipt({ sessionId: OTHER_THREAD }), deps);
    expect(stranger.ok).toBe(false);
    expect(await acceptCodexPolicyReceipt(receipt(), { ...deps, enabled: () => false }))
      .toEqual({ ok: false, error: { code: "unsupported", message: "agent integrations are switched off on this Mac" } });
    expect(store.list(createSessionStore(db).find(codex(THREAD))!.key, 1)).toEqual([]);
  });

  test("an unavailable verdict raises the policy-unavailable attention through the daemon", async () => {
    const bound = bindAgent(THREAD);
    const raised: Array<{ key: string; action: string; detail: string }> = [];
    const handlers = createAgentIntegrationHandlers({
      receipts: {
        enabled: () => true, resolve, store: createCodexPolicyReceipts(), activeTurn: () => TURN,
        attention: (context, action, detail) => { raised.push({ key: context.binding.key, action, detail }); },
      },
    });
    expect(await handlers["agent:policy-receipt"](receipt({ verdict: "unavailable", detail: "the gate service gave no verdict", event: "PreToolUse", tool: "request_user_input" })))
      .toEqual({ ok: true, data: { turn: "current", diagnostic: false } });
    expect(raised).toEqual([{ key: bound.key, action: "ask", detail: "the gate service gave no verdict" }]);
    expect(await handlers["agent:policy-receipt"]({ ...receipt(), extra: 1 })).toEqual({
      ok: false, error: "a receipt has no extra field", failure: { code: "invalid", message: "a receipt has no extra field" },
    });
  });

  test("policy-unavailable attention has its own words; native question attention keeps its own", () => {
    const store = createGatesStore({ dbPath: join(dir, "gates.db"), log: pino({ level: "silent" }) });
    const warned: string[] = [];
    const emitted: string[] = [];
    const log = { warn: (_d: unknown, message: string) => { warned.push(message); }, info: () => {}, debug: () => {} };
    const on = createGateQuestions({ gates: store, enabled: () => true, emit: (topic) => { emitted.push(topic); }, log: log as never });
    on.native.attention({ reason: "policy-unavailable" });
    on.native.attention({ reason: "async-question" });
    expect(warned).toEqual([
      "policy: a session's workflow policy could not decide, so it is not ready for managed work until it is checked again",
      "gate: a native question needs a person; it is not a gate rt can answer",
    ]);
    expect(emitted).toEqual(["gate.native-attention", "gate.native-attention"]);
    const off = createGateQuestions({ gates: store, enabled: () => false, emit: (topic) => { emitted.push(topic); }, log: log as never });
    off.native.attention({ reason: "policy-unavailable" });
    expect(emitted).toHaveLength(2);
  });
});

// ─── Adapter ─────────────────────────────────────────────────────────────────

describe("createCodexPolicy", () => {
  function project(opts: { trust?: boolean; hookTrust?: boolean; command?: string; matcher?: string } = {}) {
    const root = join(dir, "project");
    const cwd = join(root, "packages", "app");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".codex"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const manifest = codexPolicyManifest({ executable: EXE, installationId: INSTALLATION });
    const hooks = JSON.parse(JSON.stringify(manifest.hooks)) as typeof manifest.hooks;
    if (opts.command) hooks.Stop[0]!.hooks[0]!.command = opts.command;
    if (opts.matcher) (hooks.PreToolUse[0] as Record<string, unknown>).matcher = opts.matcher;
    writeFileSync(join(root, ".codex", "hooks.json"), JSON.stringify({ hooks }, null, 2));
    const home = join(dir, "codex-home");
    mkdirSync(home, { recursive: true });
    const source = join(root, ".codex", "hooks.json");
    const lines = [
      ...(opts.trust === false ? [] : [`[projects.${JSON.stringify(root)}]`, `trust_level = "trusted"`]),
      ...(opts.hookTrust === false ? [] : [
        `[hooks.state.${JSON.stringify(`${source}:pre_tool_use:0:0`)}]`, `trusted_hash = "sha256:${"a".repeat(64)}"`,
        `[hooks.state.${JSON.stringify(`${source}:stop:0:0`)}]`, `trusted_hash = "sha256:${"b".repeat(64)}"`,
      ]),
    ];
    writeFileSync(join(home, "config.toml"), lines.join("\n") + "\n");
    return { root, cwd, home, env: { HOME: dir, CODEX_HOME: home } as NodeJS.ProcessEnv };
  }
  const request = (cwd: string, required: LaunchRequest["required"] = []): LaunchRequest => ({
    reservationId: "res-1", cwd, mode: "herdr", selection: { harness: "codex", options: {} }, required, access: { readRoots: [] },
  });

  test("prepare and verify inspect the installed hooks, their trust and the executable", async () => {
    const p = project();
    let bytes = "rt 2.30.0";
    const policy = createCodexPolicy({ env: p.env, fingerprint: () => bytes, now: () => 7 });
    const prepared = await policy.prepare(request(p.cwd));
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(prepared.data).toEqual(expect.objectContaining({ harness: "codex", profile: p.home, cwd: p.cwd }));
    const bound = bindAgent(THREAD, { profile: p.home });
    expect(await policy.verify(bound, prepared.data)).toEqual({
      ok: true, data: { sessionKey: bound.key, generation: bound.attachment.generation, revision: prepared.data.revision, verified: [], observedAt: 7 },
    });

    bytes = "rt 2.30.0 patched";
    expect(await policy.verify(bound, prepared.data)).toEqual({ ok: false, error: { code: "not-ready", message: "the Codex policy hooks changed after they were prepared" } });
    expect(await policy.verify({ ...bound, native: { ...bound.native, harness: "claude" } }, prepared.data)).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await policy.verify({ ...bound, native: { ...bound.native, profile: "default" } }, prepared.data)).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  test("an unverified async native path cannot advertise policy", async () => {
    expect(CODEX_PROVEN_POLICY).toEqual([]);
    for (const mode of ["herdr", "headless"] as const) {
      expect(codexSupported(mode)).not.toContain("gate-policy");
      expect(codexSupported(mode)).not.toContain("continuation-policy");
    }
    const p = project();
    const policy = createCodexPolicy({ env: p.env, fingerprint: () => "x" });
    for (const cap of ["gate-policy", "continuation-policy"] as const) {
      const prepared = await policy.prepare(request(p.cwd, [cap]));
      expect(prepared).toMatchObject({ ok: false, error: { code: "not-ready" } });
      if (!prepared.ok) expect(prepared.error.message).toContain(cap);
    }
  });

  test("prepare is not ready for a missing, edited, untrusted or unreviewed hook", async () => {
    const cases: Array<[string, Parameters<typeof project>[0], string]> = [
      ["untrusted folder", { trust: false }, "does not trust"],
      ["untrusted hook", { hookTrust: false }, "has not trusted rt's PreToolUse policy hook"],
      ["edited command", { command: `'${EXE}' agent policy-hook --installation 'inst-test-2' --event 'Stop'` }, "different executables or installations"],
      ["matcher added", { matcher: "request_user_input" }, "differs from the reviewed manifest"],
    ];
    for (const [name, opts, want] of cases) {
      rmSync(join(dir, "project"), { recursive: true, force: true });
      const p = project(opts);
      const prepared = await createCodexPolicy({ env: p.env, fingerprint: () => "x" }).prepare(request(p.cwd));
      expect({ name, ok: prepared.ok }).toEqual({ name, ok: false });
      if (!prepared.ok) expect({ name, message: prepared.error.message }).toEqual({ name, message: expect.stringContaining(want) });
    }
    const bare = join(dir, "bare");
    mkdirSync(bare, { recursive: true });
    const none = await createCodexPolicy({ env: { HOME: dir, CODEX_HOME: join(dir, "codex-home") }, fingerprint: () => "x" }).prepare(request(bare));
    expect(none).toMatchObject({ ok: false, error: { code: "not-ready", message: expect.stringContaining("installs rt's PreToolUse policy hook") } });
  });
});
