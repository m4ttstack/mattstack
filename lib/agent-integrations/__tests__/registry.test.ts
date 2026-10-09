import { describe, expect, test } from "bun:test";
import type { Capability, CapabilityReport, Mode } from "../../../packages/rt-client/src/agent-integrations.ts";
import type { HarnessIntegration, SessionAdapter } from "../contracts.ts";
import { admit } from "../admission.ts";
import type { HarnessInstall } from "../install.ts";
import { createRegistry } from "../registry.ts";

// Registration must not call any integration operation or lazy factory.
function unexpectedOperation(): never { throw new Error("Registration invoked an integration"); }
const sessions: SessionAdapter = {
  launch: unexpectedOperation, resume: unexpectedOperation, discover: unexpectedOperation,
  observe: unexpectedOperation, startWork: unexpectedOperation,
};
function fixture(id = "fixture"): HarnessIntegration {
  return {
    id, label: "Fixture harness", loadSessions: unexpectedOperation,
    capabilities: unexpectedOperation, validateOptions: unexpectedOperation, options: unexpectedOperation,
    loadMessaging: unexpectedOperation, loadQuestions: unexpectedOperation,
    loadPolicy: unexpectedOperation, loadSkills: unexpectedOperation,
  };
}
function report(supported: Capability[], ready = true, reason?: string): CapabilityReport {
  return { mode: "headless", supported, readiness: { ready, reason } };
}

describe("createRegistry", () => {
  test("registers a third harness without selecting one for an unknown ID", () => {
    const fake = fixture();
    const registry = createRegistry([fake]);
    expect(registry.get("fixture")).toBe(fake);
    expect(registry.get("claude")).toBeUndefined();
    expect(registry.get("toString")).toBeUndefined();
    expect(registry.get("__proto__")).toBeUndefined();
    expect(registry.list()).toEqual([fake]);
  });
  test("rejects duplicate IDs instead of shadowing an integration", () => {
    expect(() => createRegistry([fixture(), fixture()])).toThrow(/duplicate.*fixture/i);
  });
  test("allows an empty registry without silently installing built-ins", () => {
    const registry = createRegistry([]);
    expect(registry.list()).toEqual([]);
    expect(registry.get("codex")).toBeUndefined();
  });
  test("snapshots membership without freezing or invoking the caller's integrations", () => {
    const first = fixture("first");
    const second = fixture("second");
    const items = [first, second];
    const registry = createRegistry(items);
    items.reverse();
    items.push(fixture("later"));
    expect(registry.list()).toEqual([first, second]);
    expect(registry.get("later")).toBeUndefined();
    expect(Object.isFrozen(first)).toBe(false);
    expect(Object.isFrozen(items)).toBe(false);
    expect(() => (registry.list() as HarnessIntegration[]).pop()).toThrow();
    expect(registry.get("second")).toBe(second);
  });
});

describe("admit", () => {
  test("refuses launch-only support when gate policy is required", () => {
    const result = admit(report(["launch"]), ["gate-policy"]);
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported" } });
    if (!result.ok) expect(result.error.message).toContain("gate-policy");
  });
  test("requires every requested capability", () => {
    const result = admit(report(["launch", "observe"]), ["launch", "resume", "gate-policy"]);
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported" } });
    if (!result.ok) {
      expect(result.error.message).toContain("resume");
      expect(result.error.message).toContain("gate-policy");
    }
  });
  test("accepts a ready report with all requirements in any order", () => {
    expect(admit(report(["observe", "resume", "launch"]), ["launch", "resume", "launch"]))
      .toEqual({ ok: true, data: undefined });
  });
  test("refuses an unready report even when all capabilities are present", () => {
    expect(admit(report(["launch"], false, "Sign in to the fixture harness"), ["launch"]))
      .toEqual({ ok: false, error: { code: "not-ready", message: "Sign in to the fixture harness" } });
  });
  test("reports readiness before missing capabilities", () => {
    expect(admit(report([], false), ["launch"]))
      .toMatchObject({ ok: false, error: { code: "not-ready", message: expect.any(String) } });
  });
  test("empty requirements still require readiness", () => {
    expect(admit(report([]), [])).toEqual({ ok: true, data: undefined });
    expect(admit(report([], false), [])).toMatchObject({ ok: false, error: { code: "not-ready" } });
  });
  test("does not change its report or requirement list", () => {
    const input = report(["launch", "observe"]);
    const required = Object.freeze(["observe", "launch"] as const);
    const before = structuredClone(input);
    Object.freeze(input.supported);
    Object.freeze(input.readiness);
    Object.freeze(input);
    expect(admit(input, required)).toEqual({ ok: true, data: undefined });
    expect(input).toEqual(before);
    expect(required).toEqual(["observe", "launch"]);
  });
});

// These declarations are checked by the root TypeScript gate; no native operation runs.
const launchOnly = {
  id: "launch-only", label: "Launch only", loadSessions: async () => sessions,
  capabilities: async (mode: Mode) => ({ mode, readiness: { ready: true }, supported: ["launch" as const] }),
  validateOptions: unexpectedOperation, options: unexpectedOperation,
} satisfies HarnessIntegration;
const advertises = <C extends Capability>(capability: C) => async (mode: Mode) =>
  ({ mode, readiness: { ready: true }, supported: [capability] });
// @ts-expect-error Launch requires a sessions factory.
const absentSessions: HarnessIntegration = {
  id: "no-sessions", label: "No sessions", capabilities: advertises("launch"),
  validateOptions: unexpectedOperation, options: unexpectedOperation,
};
// @ts-expect-error Peer delivery requires a messaging factory.
const absentMessaging: HarnessIntegration = { ...launchOnly, capabilities: advertises("peer-idle") };
// @ts-expect-error Busy peer delivery requires a messaging factory too.
const absentBusyMessaging: HarnessIntegration = { ...launchOnly, capabilities: advertises("peer-working") };
// @ts-expect-error A native question form requires a questions factory.
const absentForm: HarnessIntegration = { ...launchOnly, capabilities: advertises("questions-form") };
// @ts-expect-error Gate waits require a questions factory.
const absentWait: HarnessIntegration = { ...launchOnly, capabilities: advertises("questions-wait") };
// @ts-expect-error Question recovery requires a questions factory.
const absentRecovery: HarnessIntegration = { ...launchOnly, capabilities: advertises("question-recovery") };
// @ts-expect-error Async questions require a questions factory.
const absentAsync: HarnessIntegration = { ...launchOnly, capabilities: advertises("questions-async") };
// @ts-expect-error Gate policy requires a policy factory.
const absentGatePolicy: HarnessIntegration = { ...launchOnly, capabilities: advertises("gate-policy") };
// @ts-expect-error Continuation policy requires a policy factory.
const absentContinuation: HarnessIntegration = { ...launchOnly, capabilities: advertises("continuation-policy") };
// @ts-expect-error Skills require a skills factory.
const absentSkills: HarnessIntegration = { ...launchOnly, capabilities: advertises("skills") };
const sessionless = { id: "sessionless", label: "Sessionless", validateOptions: unexpectedOperation, options: unexpectedOperation };
// @ts-expect-error Messaging acts on a session binding, so it requires a sessions factory.
const messagingWithoutSessions: HarnessIntegration = { ...sessionless, loadMessaging: unexpectedOperation, capabilities: advertises("peer-idle") };
// @ts-expect-error Caller context resolves to a session binding, so it requires a sessions factory.
const callerContextWithoutFactories: HarnessIntegration = { ...sessionless, capabilities: advertises("caller-context") };
// @ts-expect-error Questions act on a session binding, so they require a sessions factory.
const questionsWithoutSessions: HarnessIntegration = { ...sessionless, loadQuestions: unexpectedOperation, capabilities: advertises("worktrees") };

// Positive compile fixtures exercise each declared operation's canonical inputs
// and outputs. No native adapter or shared-runtime routing is exercised here.
const declaredOperations: HarnessIntegration = {
  ...launchOnly,
  capabilities: async (mode) => ({ mode, readiness: { ready: true }, supported: [
    "launch", "resume", "observe", "peer-idle", "peer-working", "questions-form",
    "questions-wait", "question-recovery", "questions-async", "gate-policy",
    "continuation-policy", "skills",
  ] }),
  validateOptions: (options) => ({ ok: true, data: options }),
  options: async () => [{ name: "model", kind: "choice", choices: ["fixture-model"] }],
  loadSessions: async () => ({
    launch: async (request) => ({ ok: true, data: {
      native: { harness: request.selection.harness, profile: "fixture", kind: "id", value: "native-id" },
      attachment: { mode: request.mode },
    } }),
    resume: async (native, request) => ({ ok: true, data: { native, attachment: { mode: request.mode } } }),
    discover: async () => [],
    observe: async (binding) => ({ ok: true, data: {
      connectivity: "unknown", execution: "unknown", background: "unknown",
      observedAt: 1, source: "fixture", generation: binding.attachment.generation,
    } }),
    startWork: async (_binding, input) => ({ ok: true, data: { id: input.id, evidence: "submitted" } }),
  }),
  loadMessaging: async () => ({
    submit: async (_binding, input) => ({ ok: true, data: { id: input.id, evidence: "queued" } }),
    reconcile: async (_binding, _inputId) => ({ ok: true, data: null }),
  }),
  loadQuestions: async () => ({
    complete: async (_binding, _question, row) => ({ ok: true, data: row.answer ? "completed" : "pending" }),
  }),
  loadPolicy: async () => ({
    prepare: async (request) => ({ ok: true, data: {
      id: "policy", harness: request.selection.harness, profile: "fixture", cwd: request.cwd, revision: "revision",
    } }),
    verify: async (binding, prepared) => ({ ok: true, data: {
      sessionKey: binding.key, generation: binding.attachment.generation,
      revision: prepared.revision, verified: [], observedAt: 1,
    } }),
  }),
  loadSkills: async () => ({
    inventory: async () => ({ ok: true, data: [{ id: "fixture", installPath: "/fixture/plugin" }] }),
    resourceRoots: async () => ({ ok: true, data: ["/fixture/plugin"] }),
    resolveResource: async (_plugin, _relativePath) => ({ ok: true, data: "/fixture/plugin/SKILL.md" }),
    skillsDir: () => ({ ok: true, data: "/fixture/skills" }),
    maintain: async (_operation, _source) => ({ ok: true, data: undefined }),
  }),
};
const declaredInstall: HarnessInstall = {
  id: "fixture",
  loadInstall: async () => ({
    steps: () => [],
    verify: async () => ({ ok: true, data: { ready: true } }),
    reconcile: async (_mode, _context) => [{ state: "skipped", detail: "Fixture only" }],
  }),
};
