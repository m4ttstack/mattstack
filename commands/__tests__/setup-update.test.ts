import { describe, test, expect } from "bun:test";
import { setupUpdate, type ApplyDeps } from "../setup.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../../lib/setup/apply.ts";
import type { ApplyEvent, StepId } from "../../lib/setup/contract.ts";
import type { RelayClient } from "../../lib/team/relay-client.ts";
import type { SecretsSeams } from "../../lib/secrets/store.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { readSetupState } from "../../lib/setup/state.ts";
import type { MigrationDef } from "../../lib/setup/migrations/index.ts";

const fakeSecrets: SecretsSeams = {
  ageKeySeam: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
  execSeam: {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    fileExists: () => false,
    statFile: () => null,
    readFile: () => "",
    writeFile: () => {},
    ensureDir: () => {},
    chmod: () => {},
    fsyncAndRename: () => {},
    removeFile: () => {},
  },
};

const fakeRelay: RelayClient = {
  create: async () => ({ id: "", creatorSecret: "" }),
  fetch: async () => "gone",
  redeem: async () => "already",
  reply: async () => {},
  readReply: async () => "none",
  delete: async () => {},
};

function fakeSecretPresence(): SecretPresence {
  return { async has() { return null; } };
}

function fakeStep(id: StepId, outcome: StepOutcome | ((ctx: ApplyContext) => Promise<StepOutcome>)): StepDef {
  return {
    id,
    title: id,
    kind: "rt",
    applies: () => true,
    run: typeof outcome === "function" ? outcome : async () => outcome,
  };
}

/** Never invoked: proves a branch that must short-circuit before touching the engine really does. */
function neverRunsStep(id: StepId): StepDef {
  return {
    id,
    title: id,
    kind: "rt",
    applies: () => true,
    run: async () => {
      throw new Error(`${id} must never run`);
    },
  };
}

function baseApplyDeps(
  overrides: Partial<Omit<ApplyDeps, "probes">> & { probes?: ReturnType<typeof fakeProbes> } = {},
): Omit<ApplyDeps, "probes"> & { probes: ReturnType<typeof fakeProbes>; lines: string[]; exitCodes: number[]; confirmCalls: string[] } {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  const confirmCalls: string[] = [];
  return {
    probes: fakeProbes(),
    secrets: fakeSecrets,
    relay: fakeRelay,
    secretPresence: fakeSecretPresence(),
    print: (s) => lines.push(s),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    isTTY: () => false,
    planForGate: async () => ({ requiredMissing: [] }),
    confirm: async (message) => {
      confirmCalls.push(message);
      return true;
    },
    lines,
    exitCodes,
    confirmCalls,
    ...overrides,
  };
}

const DAEMON = "/fake-home/.mattstack/rt/daemon.json";
const STATE = "/fake-home/.mattstack/rt/setup-state.json";

function updateStep(id: StepId, outcome: StepOutcome): StepDef {
  return { ...fakeStep(id, outcome), updateSafe: true };
}

function updateDeps(overrides: Parameters<typeof baseApplyDeps>[0] = {}) {
  const notifications: { category: string; title: string; message: string; id: string }[] = [];
  const deps = baseApplyDeps({
    version: "2.15.0",
    migrations: [],
    steps: [updateStep("path.link", { state: "done", detail: "linked" }), updateStep("verify", { state: "done", detail: "1 check passed" })],
    notify: (category, title, message, id) => { notifications.push({ category, title, message, id }); },
    ...overrides,
  });
  return { ...deps, notifications };
}

async function run(deps: ReturnType<typeof updateDeps>, args: string[]): Promise<void> {
  try {
    await setupUpdate(args, {}, deps);
  } catch (err) {
    if (!(err instanceof Error && err.message === "exit sentinel")) throw err;
  }
}

function jsonEvents(lines: string[]): ApplyEvent[] {
  return lines.map((l) => JSON.parse(l) as ApplyEvent);
}

describe("rt setup update", () => {
  test("never set up: a single done skipped:not-set-up, exit 0, nothing runs, no stamp", async () => {
    const deps = updateDeps({ steps: [neverRunsStep("path.link")] });
    await run(deps, ["--json"]);
    expect(jsonEvents(deps.lines)).toEqual([{ event: "done", ok: true, skipped: "not-set-up" }]);
    expect(deps.exitCodes).toEqual([]);
    expect(deps.probes.readFile(STATE)).toBeNull();
  });

  test("human mode prints the not-set-up line", async () => {
    const deps = updateDeps();
    await run(deps, []);
    expect(deps.lines).toEqual(["setup update: this Mac has not been set up yet"]);
  });

  test("current stamp: done skipped:current, exit 0, nothing runs", async () => {
    const deps = updateDeps({ probes: fakeProbes({ files: { [DAEMON]: "{}", [STATE]: JSON.stringify({ v: 1, lastUpdate: { version: "2.15.0", at: "x" } }) } }), steps: [neverRunsStep("path.link")] });
    await run(deps, ["--json"]);
    expect(jsonEvents(deps.lines)).toEqual([{ event: "done", ok: true, skipped: "current" }]);
    const human = updateDeps({ probes: fakeProbes({ files: { [DAEMON]: "{}", [STATE]: JSON.stringify({ v: 1, lastUpdate: { version: "2.15.0", at: "x" } }) } }), steps: [neverRunsStep("path.link")] });
    await run(human, []);
    expect(human.lines).toEqual(["setup update: already applied for 2.15.0"]);
  });

  test("a run streams plan, steps and done, stamps the version, prints the summary, exits 0 and posts nothing when all clear", async () => {
    const deps = updateDeps({ probes: fakeProbes({ files: { [DAEMON]: "{}" } }) });
    await run(deps, []);
    expect(deps.lines.at(-1)).toBe("setup update: changed: path.link, verify");
    expect(deps.exitCodes).toEqual([]);
    expect(deps.notifications).toEqual([]);
    expect(readSetupState(deps.probes).lastUpdate?.version).toBe("2.15.0");
  });

  test("--json streams the events and the summary rides on no extra line", async () => {
    const deps = updateDeps({ probes: fakeProbes({ files: { [DAEMON]: "{}" } }) });
    await run(deps, ["--json"]);
    const events = jsonEvents(deps.lines);
    expect(events[0]?.event).toBe("plan");
    expect(events.at(-1)).toEqual({ event: "done", ok: true });
  });

  test("a needs-you item exits 2, still stamps, and posts one notification under the version id", async () => {
    const deps = updateDeps({
      probes: fakeProbes({ files: { [DAEMON]: "{}" } }),
      steps: [updateStep("path.link", { state: "done" }), updateStep("verify", { state: "needs-you", detail: "to connect: Slack" })],
    });
    await run(deps, []);
    expect(deps.exitCodes).toEqual([2]);
    expect(readSetupState(deps.probes).lastUpdate?.version).toBe("2.15.0");
    expect(deps.notifications).toEqual([{ category: "setup_update", title: "Setup needs you after the update to 2.15.0", message: "verify: to connect: Slack", id: "setup_update:2.15.0" }]);
  });

  test("a failed item exits 2 and stamps anyway, so the next launch does not nag again", async () => {
    const deps = updateDeps({
      probes: fakeProbes({ files: { [DAEMON]: "{}" } }),
      steps: [updateStep("path.link", { state: "failed", detail: "no bin" }), updateStep("verify", { state: "done" })],
    });
    await run(deps, []);
    expect(deps.exitCodes).toEqual([2]);
    expect(readSetupState(deps.probes).lastUpdate?.version).toBe("2.15.0");
    expect(deps.notifications.length).toBe(1);
  });

  test("--force reruns over a current stamp and reuses the same notification id", async () => {
    const deps = updateDeps({
      probes: fakeProbes({ files: { [DAEMON]: "{}", [STATE]: JSON.stringify({ v: 1, lastUpdate: { version: "2.15.0", at: "x" } }) } }),
      steps: [updateStep("verify", { state: "needs-you", detail: "to connect: Slack" })],
    });
    await run(deps, ["--force"]);
    expect(deps.notifications.map((n) => n.id)).toEqual(["setup_update:2.15.0"]);
  });

  test("runs the pending migrations from deps.migrations and records them", async () => {
    const migrations: MigrationDef[] = [{ id: "2026-09-30-a", title: "a", run: async () => ({ state: "done" }) }];
    const deps = updateDeps({ probes: fakeProbes({ files: { [DAEMON]: "{}" } }), migrations });
    await run(deps, []);
    expect(readSetupState(deps.probes).migrations).toEqual(["2026-09-30-a"]);
  });

  test("the context is non-interactive: a step that calls need() gets no-app, never a hang", async () => {
    let reply: unknown;
    const deps = updateDeps({
      probes: fakeProbes({ files: { [DAEMON]: "{}" } }),
      steps: [{ ...updateStep("path.link", { state: "done" }), run: async (ctx) => { reply = await ctx.need("path.link", { type: "app-privileged", op: "proxy-install" }); return { state: "done" }; } }],
    });
    await run(deps, []);
    expect(["no-app", "app-unanswerable"]).toContain(reply as string);
  });

  test.each(["--from", "--only"])("%s is refused with the exit-2 envelope", async (flag) => {
    const deps = updateDeps({ probes: fakeProbes({ files: { [DAEMON]: "{}" } }) });
    await run(deps, [flag, "path.link", "--json"]);
    expect(deps.exitCodes).toEqual([2]);
    expect(JSON.parse(deps.lines[0]!).error.code).toBe("unknown-flag");
  });

  test("a stamp write that throws does not lose the notification or the exit code", async () => {
    const probes = fakeProbes({ files: { [DAEMON]: "{}" } });
    const realWrite = probes.writeFile.bind(probes);
    probes.writeFile = (path, content, mode) => {
      if (path === STATE) throw new Error("disk full");
      return realWrite(path, content, mode);
    };
    const deps = updateDeps({
      probes,
      steps: [updateStep("verify", { state: "needs-you", detail: "to connect: Slack" })],
    });
    await run(deps, []);
    expect(deps.exitCodes).toEqual([2]);
    expect(deps.notifications.map((n) => n.id)).toEqual(["setup_update:2.15.0"]);
  });
});
