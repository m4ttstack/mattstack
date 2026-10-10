import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pino from "pino";
import type { Capability, Mode, Outcome } from "../../../packages/rt-client/src/agent-integrations.ts";
import { builtinRegistry } from "../../../lib/agent-integrations/builtins.ts";
import { inTestedRange } from "../../../lib/agent-integrations/claude/mod-links.ts";
import { CODEX_PROTOCOL_VERSION } from "../../../lib/agent-integrations/codex/protocol.ts";
import type { HarnessIntegration, MessageAdapter, QuestionAdapter, SessionAdapter } from "../../../lib/agent-integrations/contracts.ts";
import { createDeliveryService, oneShotInput } from "../../../lib/agent-integrations/delivery.ts";
import { createBoundLauncher } from "../../../lib/agent-integrations/launch.ts";
import { createGateQuestions } from "../../../lib/agent-integrations/questions.ts";
import { createRegistry } from "../../../lib/agent-integrations/registry.ts";
import { createSessionStore } from "../../../lib/agent-integrations/session-store.ts";
import { createGatesStore } from "../../../lib/daemon/gates-store.ts";
import { chooseJobWorker } from "../../../lib/daemon/herd-selection.ts";
import { openStateDb } from "../../../lib/state/db.ts";
import { declarationProblems } from "../conformance.ts";
import { loadEnvironment } from "../environment.ts";
import {
  evidencePathProblem, matrixProblems, readEvidence, readMatrix, restartProblems,
  type EvidenceFile, type TestedMatrix,
} from "../evidence.ts";
import {
  blockedRun, captureDriver, parseNativeEvents, runHarnessAcceptance, runProfile, verifyHarnessAcceptance,
  type Driver,
} from "../harnesses.ts";
import { PLAN_SCENARIO_IDS, PROFILES, requiredSlots, SCENARIOS, slotKey, type Profile } from "../scenarios.ts";
import { COMMIT, fixtureEnv, type FixtureEnv } from "./fixture-env.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const MATRIX_PATH = join(ROOT, "scripts", "acceptance", "tested-versions.json");

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function env(opts: Parameters<typeof fixtureEnv>[0] = {}): FixtureEnv {
  const e = fixtureEnv(opts);
  scratch.push(e.root);
  return e;
}

function matrix(): TestedMatrix {
  const m = readMatrix(MATRIX_PATH);
  if (!m.ok) throw new Error(m.error.message);
  return m.data;
}

function load(path: string): EvidenceFile {
  const doc = readEvidence(path);
  if (!doc.ok) throw new Error(doc.error.message);
  return doc.data;
}

/** Runs all three profiles against passing captures and returns the evidence file. */
async function passingMatrix(): Promise<{ evidence: string; envs: Record<Profile, FixtureEnv> }> {
  const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
  const envs = {} as Record<Profile, FixtureEnv>;
  for (const profile of PROFILES) {
    const e = env();
    e.captureAllPassing(profile);
    envs[profile] = e;
    await runHarnessAcceptance({ profile, evidence, environment: e.descriptorPath, execFor: () => e.exec });
  }
  return { evidence, envs };
}

describe("the acceptance matrix", () => {
  test("names every scenario the plan requires, verbatim, in every profile", () => {
    for (const profile of PROFILES) {
      const ids = new Set(requiredSlots(profile).map((s) => s.scenario.id));
      for (const id of PLAN_SCENARIO_IDS) expect(ids.has(id)).toBe(true);
    }
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  test("mixed requires each harness and both shepherds", () => {
    const keys = requiredSlots("mixed").map((s) => slotKey(s.scenario.id, s.harness));
    expect(keys).toContain("hook-timeout@claude");
    expect(keys).toContain("hook-timeout@codex");
    expect(keys).toContain("mixed-shepherd-claude");
    expect(keys).toContain("mixed-shepherd-codex");
    expect(requiredSlots("claude-only").some((s) => s.harness === "codex")).toBe(false);
  });

  test("a complete passing matrix verifies", async () => {
    const { evidence } = await passingMatrix();
    expect(verifyHarnessAcceptance(evidence, MATRIX_PATH)).toEqual({ ok: true, data: undefined });
  });

  test("matrix refuses incomplete evidence", async () => {
    const { evidence } = await passingMatrix();
    const doc = load(evidence);
    doc.profiles["codex-only"]!.scenarios = doc.profiles["codex-only"]!.scenarios.filter((s) => slotKey(s.scenario, s.harness) !== "native-restart-queued-input@codex");
    writeFileSync(evidence, JSON.stringify(doc));
    const missingScenarioResult = verifyHarnessAcceptance(evidence, MATRIX_PATH);
    expect(missingScenarioResult.ok).toBe(false);
    if (!missingScenarioResult.ok) expect(missingScenarioResult.error.message).toContain("codex-only: required scenario native-restart-queued-input@codex is missing");

    delete doc.profiles.mixed;
    writeFileSync(evidence, JSON.stringify(doc));
    const noMixed = verifyHarnessAcceptance(evidence, MATRIX_PATH);
    expect(noMixed.ok).toBe(false);
    if (!noMixed.ok) expect(noMixed.error.message).toContain("mixed: has not run");
  });

  test("an evidence file that does not exist is a failure, not an empty pass", () => {
    const result = verifyHarnessAcceptance(join(tempDir("rt-acceptance-none-"), "acceptance.json"), MATRIX_PATH);
    expect(result.ok).toBe(false);
  });

  test("an unsupported native form cannot turn a blocked required workflow into a pass", async () => {
    const { evidence } = await passingMatrix();
    const doc = load(evidence);
    const run = doc.profiles["codex-only"]!;
    const gate = run.scenarios.find((s) => s.scenario === "gates-external-answer")!;
    gate.outcome = "blocked";
    gate.reason = "Codex has no async question form";
    run.nativeForms = [{ harness: "codex", feature: "questions-async", status: "unsupported", note: "app-server 0.160 has no async form" }];
    const problems = matrixProblems(doc, { matrix: matrix() });
    expect(problems).toContain("codex-only: gates-external-answer@codex blocked: Codex has no async question form");
    expect(problems.some((p) => p.includes("questions-async"))).toBe(false);
  });

  test("a native form record never names a required scenario, and a scenario never takes an unsupported outcome", async () => {
    const { evidence } = await passingMatrix();
    const doc = load(evidence);
    const run = doc.profiles["codex-only"]!;
    run.nativeForms = [{ harness: "codex", feature: "hook-timeout" as never, status: "unsupported" }];
    (run.scenarios[0]! as { outcome: string }).outcome = "unsupported";
    const problems = matrixProblems(doc, { matrix: matrix() });
    expect(problems.some((p) => p.includes("hook-timeout is a required scenario, not an optional native form"))).toBe(true);
    expect(problems.some((p) => p.includes("has outcome unsupported"))).toBe(true);
  });

  test("every profile must run the same artifact", async () => {
    const { evidence } = await passingMatrix();
    const doc = load(evidence);
    const run = doc.profiles.mixed!;
    run.artifact = { commit: "f".repeat(40), version: run.artifact.version };
    for (const s of run.scenarios) s.artifact = run.artifact;
    expect(matrixProblems(doc, { matrix: matrix() }).some((p) => p.startsWith("mixed: ran artifact"))).toBe(true);
  });
});

describe("unsupported versions", () => {
  test("a native version outside the tested matrix fails the profile", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env({ versions: { claude: "2.1.295" } });
    e.captureAllPassing("claude-only");
    await runHarnessAcceptance({ profile: "claude-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const problems = matrixProblems(load(evidence), { matrix: matrix() });
    expect(problems).toContain("claude-only: claude 2.1.295 is not in the tested-version matrix");
  });

  test("the matrix lists exact versions and refuses a range", () => {
    const dir = tempDir("rt-acceptance-matrix-");
    writeFileSync(join(dir, "m.json"), JSON.stringify({ schema: 1, harnesses: { claude: { versions: ["2.1.x"] } } }));
    const result = readMatrix(join(dir, "m.json"));
    expect(result.ok).toBe(false);
  });

  test("each tested version is one the integrations were built against", () => {
    const m = matrix();
    expect(m.harnesses.claude!.versions.length).toBeGreaterThan(0);
    for (const v of m.harnesses.claude!.versions) expect(inTestedRange(v)).toBe(true);
    for (const v of m.harnesses.codex!.versions) {
      expect(existsSync(join(ROOT, "lib", "agent-integrations", "__tests__", "fixtures", "codex", `app-server-protocol-${v}.json`))).toBe(true);
    }
    expect(m.harnesses.codex!.versions).toContain(CODEX_PROTOCOL_VERSION);
  });
});

describe("stale generations", () => {
  const base = {
    before: { nativeId: "thread-1", generation: 4, pending: ["q-1"] },
    after: { nativeId: "thread-1", generation: 4, pending: [] },
    fate: "completed" as const, fateSource: "native" as const,
  };

  test("a restart proves the original operation's fate under the same native session", () => {
    expect(restartProblems(base, "x")).toEqual([]);
    expect(restartProblems({ ...base, after: { ...base.after, generation: 3 } }, "x")).toEqual(["x reads a stale attachment generation after the restart"]);
    expect(restartProblems({ ...base, after: { ...base.after, nativeId: "thread-2" } }, "x"))
      .toEqual(["x shows a different native session after the restart, which proves only a replacement"]);
    expect(restartProblems({ ...base, fateSource: "logical-id" }, "x"))
      .toEqual(["x reads its fate from a logical retry id, which does not prove native deduplication"]);
    expect(restartProblems(undefined, "x")).toEqual(["x does not record the native state before and after the restart"]);
  });

  test("a captured pass with a stale generation is recorded failed by the run", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    e.captureAllPassing("codex-only");
    e.capture("codex-only", "rt-restart-after-answer@codex", {
      outcome: "passed", files: ["r.log"],
      hook: { revision: "rev", trust: "trusted", proof: "receipts" },
      service: { id: "com.mattstack.daemon", recordedAt: "2026-10-10T00:00:00.000Z" },
      native: { ...base, after: { ...base.after, generation: 1 } },
    }, { "r.log": "restart\n" });
    const run = await runProfile({ profile: "codex-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const record = run.scenarios.find((s) => s.scenario === "rt-restart-after-answer")!;
    expect(record.outcome).toBe("failed");
    expect(record.reason).toContain("stale attachment generation");
  });
});

describe("malformed native events", () => {
  test("a malformed line is never counted as evidence", () => {
    expect(parseNativeEvents('{"harness":"codex","sessionId":"t","generation":1,"type":"turn","at":"2026-10-10T00:00:00Z"}\n', ["codex"]).ok).toBe(true);
    for (const bad of [
      "not json",
      "[1,2]",
      '{"harness":"claude","sessionId":"t","generation":1,"type":"turn","at":"2026-10-10T00:00:00Z"}',
      '{"harness":"codex","generation":1,"type":"turn","at":"2026-10-10T00:00:00Z"}',
      '{"harness":"codex","sessionId":"t","generation":-1,"type":"turn","at":"2026-10-10T00:00:00Z"}',
      '{"harness":"codex","sessionId":"t","generation":1,"at":"2026-10-10T00:00:00Z"}',
      '{"harness":"codex","sessionId":"t","generation":1,"type":"turn","at":"yesterday"}',
    ]) {
      expect(parseNativeEvents(bad, ["codex"]).ok).toBe(false);
    }
  });

  test("a capture whose native events are malformed fails its scenario", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    e.capture("codex-only", "consumption-client-id@codex", {
      outcome: "passed", files: ["c.log"], events: "events.jsonl",
      hook: { revision: "rev", trust: "trusted", proof: "receipts" },
    }, { "c.log": "ok\n", "events.jsonl": '{"harness":"codex","sessionId":"t"}\n' });
    const run = await runProfile({ profile: "codex-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const record = run.scenarios.find((s) => s.scenario === "consumption-client-id")!;
    expect(record.outcome).toBe("failed");
    expect(record.reason).toContain("native event line 1 has no attachment generation");
  });
});

describe("false capability declarations", () => {
  test("a hook proof that is not the harness's own kind fails the scenario", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    e.captureAllPassing("codex-only");
    e.capture("codex-only", "hook-timeout@codex", {
      outcome: "passed", files: ["h.log"], hook: { revision: "rev", trust: "trusted", proof: "installation" },
    }, { "h.log": "timeout\n" });
    const run = await runProfile({ profile: "codex-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const record = run.scenarios.find((s) => s.scenario === "hook-timeout")!;
    expect(record.outcome).toBe("failed");
    expect(record.reason).toContain("codex proves policy by receipts");
  });

  test("an advertised capability whose adapter cannot serve it is reported", async () => {
    const liar = fixtureIntegration({ supported: ["launch", "peer-idle", "questions-form", "skills"], messaging: {} as MessageAdapter, skills: "absent" });
    const problems = await declarationProblems(liar.integration, "herdr");
    expect(problems).toContain("pi: advertises peer-idle in herdr mode but its adapter has no submit");
    expect(problems).toContain("pi: advertises skills in herdr mode but has no loadSkills");
    expect(problems.some((p) => p.includes("questions-form"))).toBe(false);
    expect(await declarationProblems(fixtureIntegration().integration, "herdr")).toEqual([]);
  });

  test("a declaration whose adapter fails to load is reported, not trusted", async () => {
    const broken = fixtureIntegration({ supported: ["launch", "peer-working"], messagingThrows: true });
    expect(await declarationProblems(broken.integration, "headless")).toEqual([
      "pi: advertises peer-working in headless mode but loadMessaging failed (messaging transport refused)",
    ]);
  });
});

describe("the runner never passes what it did not observe", () => {
  test("with no acceptance-owned environment every required scenario is blocked", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const saved = process.env.RT_ACCEPTANCE_ENV;
    delete process.env.RT_ACCEPTANCE_ENV;
    try {
      await runHarnessAcceptance({ profile: "mixed", evidence });
    } finally {
      if (saved !== undefined) process.env.RT_ACCEPTANCE_ENV = saved;
    }
    const run = load(evidence).profiles.mixed!;
    expect(run.scenarios.length).toBe(requiredSlots("mixed").length);
    expect(run.scenarios.every((s) => s.outcome === "blocked")).toBe(true);
    expect(run.scenarios[0]!.reason).toContain("no acceptance-owned environment");
    expect(verifyHarnessAcceptance(evidence, MATRIX_PATH).ok).toBe(false);
  });

  test("a descriptor whose root carries no ownership marker is refused", () => {
    const e = env();
    rmSync(join(e.root, ".rt-acceptance-owned"));
    const loaded = loadEnvironment(e.descriptorPath);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.message).toContain("not an acceptance-owned environment");
  });

  test("an isolated environment pointed at the regular HOME is refused", () => {
    const e = env({ kind: "isolated-home" });
    const loaded = loadEnvironment(e.descriptorPath, e.descriptor.home);
    expect(loaded.ok).toBe(false);
  });

  test("the regular HOME runs no disruptive scenario, whatever its capture says", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env({ kind: "shared-home", disruptive: false });
    e.captureAllPassing("claude-only");
    const run = await runProfile({ profile: "claude-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const restart = run.scenarios.find((s) => s.scenario === "rt-restart-after-answer")!;
    expect(restart.outcome).toBe("blocked");
    expect(run.scenarios.find((s) => s.scenario === "hook-timeout")!.outcome).toBe("passed");
  });

  test("a scenario with no capture is blocked until it is captured", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    const run = await runProfile({ profile: "claude-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const record = run.scenarios.find((s) => s.scenario === "chat")!;
    expect(record.outcome).toBe("blocked");
    expect(record.reason).toContain("not captured yet");
  });

  test("a driver's pass with no evidence is not a pass", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    e.captureAllPassing("claude-only");
    const bare: Driver = async () => ({ outcome: "passed", hook: { revision: "r", trust: "trusted", proof: "installation" } });
    const run = await runProfile({ profile: "claude-only", evidence, environment: e.descriptorPath, execFor: () => e.exec, drivers: { chat: bare } });
    expect(run.scenarios.find((s) => s.scenario === "chat")!.outcome).toBe("failed");
  });

  test("a captured file carrying a credential is refused, never copied", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    e.capture("claude-only", "chat@claude", {
      outcome: "passed", files: ["chat.log"], hook: { revision: "r", trust: "trusted", proof: "installation" },
    }, { "chat.log": "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789\n" });
    const run = await runProfile({ profile: "claude-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const record = run.scenarios.find((s) => s.scenario === "chat")!;
    expect(record.outcome).toBe("failed");
    expect(record.reason).toContain("carries a credential");
    expect(existsSync(join(evidence, "..", "harness-integrations", "claude-only", "chat@claude", "chat.log"))).toBe(false);
  });

  test("evidence paths stay relative and inside the profile's folder", () => {
    expect(evidencePathProblem("harness-integrations/mixed/chat@claude/a.log", "mixed")).toBeNull();
    expect(evidencePathProblem("/Users/someone/a.log", "mixed")).not.toBeNull();
    expect(evidencePathProblem("harness-integrations/mixed/../codex-only/a.log", "mixed")).not.toBeNull();
    expect(evidencePathProblem("harness-integrations/codex-only/a.log", "mixed")).not.toBeNull();
  });

  test("each profile run replaces only its own results in the shared file", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const a = env();
    a.captureAllPassing("claude-only");
    await runHarnessAcceptance({ profile: "claude-only", evidence, environment: a.descriptorPath, execFor: () => a.exec });
    const b = env();
    await runHarnessAcceptance({ profile: "codex-only", evidence, environment: b.descriptorPath, execFor: () => b.exec });
    const first = load(evidence);
    expect(Object.keys(first.profiles)).toEqual(["claude-only", "codex-only"]);
    const claudeRun = first.profiles["claude-only"]!.runId;

    await runHarnessAcceptance({ profile: "codex-only", evidence, environment: b.descriptorPath, execFor: () => b.exec });
    const second = load(evidence);
    expect(second.profiles["claude-only"]!.runId).toBe(claudeRun);
    expect(existsSync(`${evidence}.lock`)).toBe(false);
  });

  test("the seed run records every slot blocked with its reason", () => {
    const run = blockedRun("codex-only", "not run yet: S9b");
    expect(run.scenarios.map((s) => slotKey(s.scenario, s.harness))).toEqual(requiredSlots("codex-only").map((s) => slotKey(s.scenario.id, s.harness)));
    expect(run.scenarios.every((s) => s.outcome === "blocked" && s.reason === "not run yet: S9b")).toBe(true);
  });
});

describe("Codex-only artifact never executes Claude", () => {
  test("Codex-only artifact never executes Claude", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    e.captureAllPassing("codex-only");
    const run = await runProfile({ profile: "codex-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    expect(e.calls.some((argv) => argv[0] === "claude")).toBe(false);
    expect(run.natives).toEqual({ codex: "0.160.0" });
    expect(run.claudeExecutions).toBe(0);
    expect(run.scenarios.find((s) => s.scenario === "codex-only-no-claude")!.outcome).toBe("passed");
    expect(run.scenarios.every((s) => s.outcome === "passed")).toBe(true);
  });

  test("a step that tries to start Claude in a Codex-only run fails, and Claude never starts", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    e.captureAllPassing("codex-only");
    const sneaky: Driver = async (ctx) => {
      ctx.exec(["claude", "-p", "hello"]);
      return { outcome: "passed" };
    };
    const run = await runProfile({ profile: "codex-only", evidence, environment: e.descriptorPath, execFor: () => e.exec, drivers: { "skills-mcp": sneaky } });
    expect(e.calls.some((argv) => argv[0] === "claude")).toBe(false);
    const record = run.scenarios.find((s) => s.scenario === "skills-mcp")!;
    expect(record.outcome).toBe("failed");
    expect(record.reason).toBe("the codex-only run refused to start claude");
  });

  test("the installed artifact calling Claude shows on the tripwire and fails the profile", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    e.captureAllPassing("codex-only");
    mkdirSync(join(e.root, "tripwire"), { recursive: true });
    writeFileSync(e.descriptor.claudeTripwireLog!, "2026-10-10T00:00:00Z claude --version (parent: rt)\n");
    await runHarnessAcceptance({ profile: "codex-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const doc = load(evidence);
    expect(doc.profiles["codex-only"]!.claudeExecutions).toBe(1);
    expect(doc.profiles["codex-only"]!.scenarios.find((s) => s.scenario === "codex-only-no-claude")!.outcome).toBe("failed");
    expect(matrixProblems(doc, { matrix: matrix() })).toContain("codex-only: Claude ran 1 time(s) during a Codex-only run");
  });

  test("Claude configuration left in a Codex-only home fails the profile", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    mkdirSync(join(e.descriptor.home, ".claude"), { recursive: true });
    const run = await runProfile({ profile: "codex-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const record = run.scenarios.find((s) => s.scenario === "codex-only-no-claude")!;
    expect(record.outcome).toBe("failed");
    expect(record.reason).toContain("~/.claude exists");
  });

  test("a Codex-only bundle missing the Codex skill builds fails release-artifact", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    rmSync(join(e.descriptor.app, "Contents", "Helpers", "skills-targets"), { recursive: true });
    const run = await runProfile({ profile: "codex-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    const record = run.scenarios.find((s) => s.scenario === "release-artifact")!;
    expect(record.outcome).toBe("failed");
    expect(record.reason).toContain("Helpers/skills-targets/codex/board is the Codex build");
    const checks = JSON.parse(readFileSync(join(evidence, "..", record.evidence[0]!), "utf8"));
    expect(checks.some((c: { ok: boolean }) => !c.ok)).toBe(true);
  });

  test("the artifact's commit comes from the bundle's own stamp", async () => {
    const evidence = join(tempDir("rt-acceptance-ev-"), "acceptance.json");
    const e = env();
    const run = await runProfile({ profile: "claude-only", evidence, environment: e.descriptorPath, execFor: () => e.exec });
    expect(run.artifact).toEqual({ commit: COMMIT, version: "2.30.0" });
    const unstamped = env({ commit: "not-a-sha" });
    const run2 = await runProfile({ profile: "claude-only", evidence, environment: unstamped.descriptorPath, execFor: () => unstamped.exec });
    expect(run2.artifact.commit).toBeNull();
  });
});

// ── fake third integration ───────────────────────────────────────────────

type FixtureOpts = {
  supported?: Capability[];
  messaging?: MessageAdapter;
  messagingThrows?: boolean;
  skills?: "absent";
};

function fixtureIntegration(o: FixtureOpts = {}) {
  const calls = { launched: 0, submitted: [] as string[], completed: [] as string[] };
  const sessions: SessionAdapter = {
    async launch(request) {
      calls.launched++;
      return { ok: true, data: { native: { harness: "pi", profile: "default", kind: "id", value: `pi-${calls.launched}` }, attachment: { mode: request.mode, ...(request.mode === "herdr" && { pane: "w1:p1" }) } } };
    },
    async resume(native, request) {
      return { ok: true, data: { native, attachment: { mode: request.mode } } };
    },
    async discover() {
      return [];
    },
    async observe(binding) {
      return { ok: true, data: { connectivity: "connected", execution: "idle", background: "inactive", observedAt: 1, source: "pi", generation: binding.attachment.generation } };
    },
    async startWork(_binding, input) {
      return { ok: true, data: { id: input.id, evidence: "submitted" } };
    },
  };
  const messaging: MessageAdapter = o.messaging ?? {
    async submit(_binding, input) {
      calls.submitted.push(input.id);
      return { ok: true, data: { id: input.id, evidence: "queued" } };
    },
  };
  const questions: QuestionAdapter = {
    async complete(_binding, question) {
      calls.completed.push(question.gateId);
      return { ok: true, data: "completed" };
    },
  };
  const supported: Capability[] = o.supported ?? ["launch", "resume", "observe", "peer-idle", "peer-working", "questions-form", "question-recovery", "skills"];
  const integration = {
    id: "pi",
    label: "Pi harness",
    async capabilities(mode: Mode) {
      return { mode, supported, readiness: { ready: true } };
    },
    validateOptions: (options: object): Outcome<object> => ({ ok: true, data: options }),
    options: async () => [],
    loadSessions: async () => sessions,
    loadMessaging: async () => {
      if (o.messagingThrows) throw new Error("messaging transport refused");
      return messaging;
    },
    loadQuestions: async () => questions,
    ...(o.skills !== "absent" && {
      loadSkills: async () => ({
        inventory: async () => ({ ok: true, data: [] }),
        resourceRoots: async () => ({ ok: true, data: [] }),
        resolveResource: async () => ({ ok: false, error: { code: "invalid", message: "none" } }),
        skillsDir: () => ({ ok: true, data: "/pi/skills" }),
        maintain: async () => ({ ok: true, data: undefined }),
      }),
    }),
  } as unknown as HarnessIntegration;
  return { integration, calls };
}

describe("fake third integration needs no core branch", () => {
  let db: Database | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  test("fake third integration needs no core branch", async () => {
    const dir = tempDir("rt-acceptance-pi-");
    db = openStateDb(join(dir, "state.db"));
    const stateDb = db;
    const pi = fixtureIntegration();
    const registry = createRegistry([...builtinRegistry().list(), pi.integration]);
    expect(registry.list().map((i) => i.id)).toEqual(["claude", "codex", "pi"]);

    // shepherdr's worker selection takes it as an explicit assignment.
    const chosen = await chooseJobWorker(
      { explicit: { harness: "pi", options: {} }, fallback: { harness: "claude", options: {} }, enabled: ["claude", "codex", "pi"], required: ["launch", "observe"] },
      { registry, launchDefault: () => undefined },
    );
    expect(chosen).toEqual({ ok: true, data: { selection: { harness: "pi", options: {} }, mode: "herdr" } });
    if (!chosen.ok) return;

    // The shared launcher binds it.
    const store = createSessionStore(stateDb);
    const launcher = createBoundLauncher({ db: stateDb, registry, claimToken: "acceptance", enabled: () => true });
    const reservationId = store.reserve({ identity: "pi-worker" });
    const bound = await launcher.launchBoundAgent({
      reservationId, cwd: dir, mode: chosen.data.mode, selection: chosen.data.selection, required: ["launch", "observe"],
      access: { readRoots: [] },
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.data.native).toMatchObject({ harness: "pi", value: "pi-1" });
    expect(pi.calls.launched).toBe(1);

    // Peer delivery reaches its messaging adapter.
    const delivery = createDeliveryService({
      db: () => stateDb,
      messagingFor: async (binding) => registry.get(binding.native.harness)?.loadMessaging?.(),
      connectionOf: (harness) => registry.get(harness)?.messagingConnection?.(),
      liveOf: (binding) => registry.get(binding.native.harness)?.sessionLive?.(binding),
      sleep: async () => {},
    });
    const receipt = await delivery.deliverPeerInput(bound.data, oneShotInput({ id: "m-1", sender: "shepherd", recipient: "pi-worker", body: "hello" }));
    expect(receipt).toMatchObject({ ok: true, data: { id: "m-1", evidence: "queued" } });
    expect(pi.calls.submitted).toEqual(["m-1"]);

    // A gate it presents completes through its question adapter.
    const gates = createGatesStore({ dbPath: join(dir, "gates.db"), log: pino({ level: "silent" }) });
    const questions = createGateQuestions({ gates, db: () => stateDb, registry, enabled: () => true });
    const gate = gates.open({ subject: "run:pi", kind: "clarify", questions: [{ id: "go", label: "Go?", multi: false, options: ["yes", "no"] }] }).row;
    expect(await questions.bindGateQuestion({
      gateId: gate.id, sessionKey: bound.data.key, generation: bound.data.attachment.generation,
      nativeThread: "pi-1", nativeTurn: "t", nativeItem: "i", nativeQuestions: ["go"], presentation: "form",
    })).toEqual({ ok: true, data: undefined });
    gates.answer(gate.id, { go: { value: "yes" } } as never, "console");
    expect(await questions.completeGateQuestion(gate.id)).toEqual({ ok: true, data: undefined });
    await questions.idle();
    expect(pi.calls.completed).toEqual([gate.id]);
    expect(questions.completion(gate.id)?.state).toBe("completed");
  });
});
