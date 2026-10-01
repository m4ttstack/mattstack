import { describe, test, expect } from "bun:test";
import {
  realIntentDeps,
  setupApply,
  setupInteractive,
  setupIntent,
  type ApplyDeps,
  type IntentDeps,
} from "../setup.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../../lib/setup/apply.ts";
import type { ApplyEvent, StepId } from "../../lib/setup/contract.ts";
import { intentPath, readIntent } from "../../lib/setup/intent.ts";
import { isSetupFinished, readSetupState } from "../../lib/setup/state.ts";
import type { RelayClient } from "../../lib/team/relay-client.ts";
import type { SecretsSeams } from "../../lib/secrets/store.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import { UserActionableError } from "../../lib/setup/errors.ts";
import { capturePlain, expectOneJsonLine, realJson } from "./helpers/json-line.ts";

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

/** Never invoked — proves a branch that must short-circuit before touching the engine really does. */
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
    json: (v) => lines.push(JSON.stringify(v)),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    isTTY: () => false,
    planForGate: async () => ({ requiredMissing: [] }),
    planForFinish: async () => ({ finishBlockedBy: [] }),
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

async function runExpectingExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && err.message === "exit sentinel") return;
    throw err;
  }
}

describe("setupApply — NDJSON discipline", () => {
  test("--json: stdout lines parse as plan, step, step, done for one done stub step", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done", detail: "ok" })] });

    await setupApply(["--json"], {}, deps);

    // Every line is valid, self-contained JSON — the NDJSON contract's own
    // invariant, asserted directly rather than trusted from the emitter.
    const events = deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
    expect(events.map((e) => e.event)).toEqual(["plan", "step", "step", "done"]);
    expect((events[1] as { state: string }).state).toBe("running");
    expect((events[2] as { state: string }).state).toBe("done");
    expect((events[3] as { ok: boolean }).ok).toBe(true);
    expect(deps.exitCodes).toEqual([]);
  });

  test("--json: a hostile log line (newline, NUL, tab) never breaks the one-object-per-line contract", async () => {
    const hostile = "line one\nline two\u0000\tembedded";
    const deps = baseApplyDeps({
      steps: [fakeStep("path.link", async (ctx) => { ctx.log("path.link", hostile); return { state: "done" }; })],
    });

    await setupApply(["--json"], {}, deps);

    for (const line of deps.lines) expect(() => JSON.parse(line)).not.toThrow();
    const logEvent = deps.lines.map((l) => JSON.parse(l) as ApplyEvent).find((e) => e.event === "log");
    expect(logEvent && "line" in logEvent ? logEvent.line : null).toBe(hostile);
  });

  test("human mode never emits JSON — one rendered line per step transition", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done", detail: "ok" })] });

    await setupApply([], {}, deps);

    for (const line of deps.lines) expect(() => JSON.parse(line)).toThrow();
    expect(deps.lines.some((l) => l.includes("path.link"))).toBe(true);
  });
});

describe("setupApply — exit-code table", () => {
  test("a failed step: exit 2, the NDJSON stream already carries the failure", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "failed", detail: "boom" })] });

    await runExpectingExit(() => setupApply(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const events = deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
    expect(events.at(-1)).toMatchObject({ event: "done", ok: false, failedStep: "path.link" });
  });

  test("a step that throws a real bug: rethrows past setupApply (exit 1 territory), not user-actionable", async () => {
    const deps = baseApplyDeps({
      steps: [{ id: "path.link", title: "x", kind: "rt", applies: () => true, run: async () => { throw new Error("real bug"); } }],
    });

    await expect(setupApply(["--json"], {}, deps)).rejects.toThrow("real bug");
    expect(deps.exitCodes).toEqual([]); // deps.exit is never called for a bug — it propagates instead
  });

  test("createApplyContext throwing a real bug rethrows past setupApply exactly like a step bug does", async () => {
    const deps = baseApplyDeps();
    deps.probes = { ...deps.probes, readDir: () => { throw new Error("readDir boom"); } };

    await expect(setupApply(["--json"], {}, deps)).rejects.toThrow("readDir boom");
    expect(deps.exitCodes).toEqual([]);
    expect(deps.lines).toEqual([]); // nothing reached the stream before the throw
  });

  test("createApplyContext throwing a UserActionableError prints the same exit-2 envelope a step failure gets — never a silently swallowed dead stream", async () => {
    const deps = baseApplyDeps();
    deps.probes = { ...deps.probes, readDir: () => { throw new UserActionableError("team-discovery-failed", "readDir boom"); } };

    // createApplyContext's discoverTeams() calls p.readDir — this proves a
    // UserActionableError thrown from inside context creation is caught by
    // setupApply's own try/catch (not left to propagate uncaught, which
    // would abandon the stream with no terminal event and no exit code).
    await runExpectingExit(() => setupApply(["--json"], {}, deps));
    expect(deps.exitCodes).toEqual([2]);
    expect(deps.lines).toHaveLength(1);
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("team-discovery-failed");
    expect(payload.error.message).toBe("readDir boom");
  });

  test("--from bogus: exit 2 with code unknown-step, named before any event reaches the stream", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })] });

    await runExpectingExit(() => setupApply(["--json", "--from", "bogus"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(deps.lines).toHaveLength(1);
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("unknown-step");
    expect(payload.error.message).toContain("bogus");
  });

  test("--from with no value (last token): exit 2 unknown-step, never a silent full re-run from step 0", async () => {
    const neverRuns = neverRunsStep("path.link");
    const deps = baseApplyDeps({ steps: [neverRuns] });

    await runExpectingExit(() => setupApply(["--json", "--from"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(deps.lines).toHaveLength(1);
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("unknown-step");
  });

  test("--from immediately followed by another flag: same refusal, not treated as the step id \"--json\"", async () => {
    const deps = baseApplyDeps({ steps: [neverRunsStep("path.link")] });

    await runExpectingExit(() => setupApply(["--from", "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
  });

  test("--from a real but gated-out step resumes there, never a silent full re-run", async () => {
    const gatedOut: StepDef = { id: "home.init", title: "home.init", kind: "rt", applies: () => false, run: async () => { throw new Error("must never run — gated out"); } };
    const deps = baseApplyDeps({
      steps: [gatedOut, fakeStep("path.link", { state: "done" })],
    });

    await setupApply(["--json", "--from", "home.init"], {}, deps);

    const events = deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
    const stepEvents = events.filter((e) => e.event === "step");
    expect(stepEvents.map((e) => (e as { id: string }).id)).toEqual(["path.link", "path.link"]);
  });

  test("--from a valid id before which nothing has run: those earlier steps get no step event at all", async () => {
    const deps = baseApplyDeps({
      steps: [neverRunsStep("home.init"), fakeStep("path.link", { state: "done" })],
    });

    await setupApply(["--json", "--from", "path.link"], {}, deps);

    const events = deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
    const plan = events[0] as { steps: { id: string }[] };
    expect(plan.steps.map((s) => s.id)).toEqual(["home.init", "path.link"]); // plan still lists every applicable step
    const stepEvents = events.filter((e) => e.event === "step");
    expect(stepEvents.every((e) => (e as { id: string }).id === "path.link")).toBe(true); // home.init never got a step event
  });

  // What the checklist's row remedies spawn: one step, not the tail of the
  // install behind it.
  test("--only runs that step alone", async () => {
    const deps = baseApplyDeps({
      steps: [neverRunsStep("home.init"), fakeStep("path.link", { state: "done" }), neverRunsStep("proxy.install")],
    });

    await setupApply(["--json", "--only", "path.link"], {}, deps);

    const events = deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
    const stepEvents = events.filter((e) => e.event === "step");
    expect(stepEvents.map((e) => (e as { id: string }).id)).toEqual(["path.link", "path.link"]);
  });

  test("--only bogus: exit 2 with code unknown-step", async () => {
    const deps = baseApplyDeps({ steps: [neverRunsStep("path.link")] });

    await runExpectingExit(() => setupApply(["--json", "--only", "bogus"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("unknown-step");
    expect(payload.error.message).toContain("bogus");
  });

  // One means one and resume means resume: honoring either silently would run
  // far more, or far less, than the caller asked for.
  test("--from and --only together: exit 2, nothing runs", async () => {
    const deps = baseApplyDeps({ steps: [neverRunsStep("path.link")] });

    await runExpectingExit(() => setupApply(["--json", "--from", "path.link", "--only", "path.link"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    // Both flags name a real step here, so the shared `unknown-step` code alone
    // would also pass if a valid id were refused for some other reason.
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("unknown-step");
    expect(payload.error.message).toContain("--from and --only cannot be combined");
  });
});

describe("setupApply — flags reach the engine", () => {
  test("--non-interactive and --team-of-one flow into ctx", async () => {
    const seen: { nonInteractive: boolean; teamOfOne: boolean }[] = [];
    const deps = baseApplyDeps({
      steps: [
        {
          id: "path.link",
          title: "x",
          kind: "rt",
          applies: () => true,
          run: async (ctx) => {
            seen.push({ nonInteractive: ctx.nonInteractive, teamOfOne: ctx.teamOfOne });
            return { state: "done" };
          },
        },
      ],
    });

    await setupApply(["--json", "--non-interactive", "--team-of-one"], {}, deps);

    expect(seen).toEqual([{ nonInteractive: true, teamOfOne: true }]);
  });
});

describe("setupInteractive — TTY-vs-json branch", () => {
  const readyExec: ExecScript = (argv) => (argv[0] === "sw_vers" ? ok("15.6") : ok());

  test("non-TTY behaves as `setup status`: prints the plan groups, never confirms", async () => {
    const deps = baseApplyDeps({ isTTY: () => false, probes: fakeProbes({ exec: readyExec }) });

    await setupInteractive([], {}, deps);

    expect(deps.lines).toContain("Your Mac");
    expect(deps.confirmCalls).toEqual([]);
  });

  test("--json on a TTY still behaves as status, never prompts", async () => {
    const deps = baseApplyDeps({ isTTY: () => true, probes: fakeProbes({ exec: readyExec }) });

    await setupInteractive(["--json"], {}, deps);

    expect(deps.confirmCalls).toEqual([]);
    expect(() => JSON.parse(deps.lines[0]!)).not.toThrow();
  });

  test("TTY, not ready, no --force: lists the blockers and exits 2 (not-ready), never confirms", async () => {
    const deps = baseApplyDeps({
      isTTY: () => true,
      probes: fakeProbes({ exec: (argv) => (argv[0] === "sw_vers" ? { code: 1, stdout: "", stderr: "no" } : ok()) }),
    });

    await runExpectingExit(() => setupInteractive([], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(deps.confirmCalls).toEqual([]);
    expect(deps.lines.some((l) => l.includes("not ready to install"))).toBe(true);
  });

  // `--force` bypasses the canInstall gate deterministically — a real
  // fakeProbes environment reaching composePlan's actual canInstall:true
  // would need every validator group satisfied, which isn't this test's
  // concern; --force exercises the exact same "proceed to confirm" branch.

  test("TTY, --force: a declined confirm never calls apply", async () => {
    const deps = baseApplyDeps({
      isTTY: () => true,
      probes: fakeProbes({ exec: readyExec }),
      confirm: async () => false,
      steps: [neverRunsStep("path.link")],
    });

    await setupInteractive(["--force"], {}, deps);

    // `confirm` is overridden above (to resolve false), which bypasses the
    // default's own confirmCalls tracking — the real proof a decline works
    // is that the never-runs step really never ran (no throw) and nothing
    // exited.
    expect(deps.exitCodes).toEqual([]);
  });

  test("TTY, --force: an accepted confirm runs apply with the same deps", async () => {
    let ran = false;
    const deps = baseApplyDeps({
      isTTY: () => true,
      probes: fakeProbes({ exec: readyExec }),
      confirm: async () => true,
      steps: [{ id: "path.link", title: "x", kind: "rt", applies: () => true, run: async () => { ran = true; return { state: "done" }; } }],
    });

    await setupInteractive(["--force"], {}, deps);

    expect(ran).toBe(true);
  });
});

describe("setupIntent", () => {
  function baseIntentDeps(
    overrides: Partial<Omit<IntentDeps, "probes">> & { probes?: ReturnType<typeof fakeProbes> } = {},
  ): Omit<IntentDeps, "probes"> & { probes: ReturnType<typeof fakeProbes>; lines: string[]; exitCodes: number[] } {
    const lines: string[] = [];
    const exitCodes: number[] = [];
    return {
      probes: fakeProbes(),
      print: (s) => lines.push(s),
      json: (v) => lines.push(JSON.stringify(v)),
      exit: (code: number) => {
        exitCodes.push(code);
        throw new Error("exit sentinel");
      },
      lines,
      exitCodes,
      ...overrides,
    };
  }

  test("restore <org>/<repo> writes intent mode restore", async () => {
    const deps = baseIntentDeps();

    await setupIntent(["restore", "o/r"], {}, deps);

    const intent = readIntent(deps.probes);
    expect(intent).toMatchObject({ mode: "restore", restore: { homeRepo: "o/r" } });
    expect(deps.probes.calls.writes[intentPath(deps.probes.home)]).toBeDefined();
  });

  test("clear removes the intent", async () => {
    const deps = baseIntentDeps();
    await setupIntent(["restore", "o/r"], {}, deps);

    await setupIntent(["clear"], {}, deps);

    expect(readIntent(deps.probes)).toBeNull();
  });

  test("an unrecognized subcommand: exit 2, bad-args", async () => {
    const deps = baseIntentDeps();

    await runExpectingExit(() => setupIntent(["bogus"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
  });

  test("restore with a malformed homeRepo: exit 2, bad-args", async () => {
    const deps = baseIntentDeps();

    await runExpectingExit(() => setupIntent(["restore", "not-a-repo-shape"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
  });

  test("--json prints the contract envelope", async () => {
    const deps = baseIntentDeps();

    await setupIntent(["restore", "o/r", "--json"], {}, deps);

    const payload = JSON.parse(deps.lines[0]!) as { contract: number; mode: string; homeRepo: string };
    expect(payload).toMatchObject({ contract: 1, mode: "restore", homeRepo: "o/r" });
  });

  test("realIntentDeps() builds without throwing", () => {
    expect(() => realIntentDeps()).not.toThrow();
  });

  test("rt setup intent solo writes the solo intent and prints it", async () => {
    const deps = baseIntentDeps();

    await setupIntent(["solo", "--json"], {}, deps);

    expect(readIntent(deps.probes)?.mode).toBe("solo");
    expect(JSON.parse(deps.lines[0]!)).toMatchObject({ contract: 1, mode: "solo" });
  });

  test("rt setup intent solo refuses with team-exists when a team clone is on disk, and writes nothing", async () => {
    const deps = baseIntentDeps({
      probes: fakeProbes({
        files: { "/fake-home/.mattstack/teams/acme/mattstack/settings.team.jsonc": "{}" },
        dirs: { "/fake-home/.mattstack/teams": ["acme"] },
      }),
    });

    await runExpectingExit(() => setupIntent(["solo", "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(deps.lines).toHaveLength(1);
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("team-exists");
    expect(payload.error.message).toContain("acme");
    expect(readIntent(deps.probes)).toBeNull();
    expect(deps.probes.calls.writes[intentPath(deps.probes.home)]).toBeUndefined();
  });
});

// A terminal or --post-install setup has no wizard to press Finish in, so a
// full run that clears the same gate Finish waits on records it itself.
describe("setupApply: a full run with nothing left to finish records Finish", () => {
  const finished = (probes: ReturnType<typeof fakeProbes>) => isSetupFinished(readSetupState(probes));

  test("a full run that ends ok with no finish blockers records Finish", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })] });
    await setupApply(["--json"], {}, deps);
    expect(finished(deps.probes)).toBe(true);
  });

  test("a full ok run stamps the update version: every update-safe step just ran", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], version: "2.15.0", migrations: [] });
    await setupApply(["--json"], {}, deps);
    expect(readSetupState(deps.probes).lastUpdate?.version).toBe("2.15.0");
  });

  test("a pending migration keeps the version unstamped, so the update run still carries it", async () => {
    const pending = { id: "2026-09-30-a", title: "a", run: async () => ({ state: "done" as const }) };
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], version: "2.15.0", migrations: [pending] });
    await setupApply(["--json"], {}, deps);
    expect(readSetupState(deps.probes).lastUpdate).toBeUndefined();
  });

  test("a stamp that cannot be written is reported and does not fail the run", async () => {
    const errors: string[] = [];
    const probes = fakeProbes();
    const realWrite = probes.writeFile.bind(probes);
    let writes = 0;
    probes.writeFile = (path, content, mode) => {
      if (path.includes("setup-state.json") && ++writes > 1) throw new Error("disk full");
      return realWrite(path, content, mode);
    };
    const deps = baseApplyDeps({ probes, steps: [fakeStep("path.link", { state: "done" })], version: "2.15.0", migrations: [], printError: (s) => errors.push(s) });
    await setupApply(["--json"], {}, deps);
    expect(deps.exitCodes).toEqual([]);
    expect(errors.some((e) => e.startsWith("rt setup apply: update version not stamped: disk full"))).toBe(true);
  });

  test("a failed run and a partial run stamp no version", async () => {
    const failed = baseApplyDeps({ steps: [fakeStep("path.link", { state: "failed", detail: "boom" })], version: "2.15.0", migrations: [] });
    await runExpectingExit(() => setupApply(["--json"], {}, failed));
    expect(readSetupState(failed.probes).lastUpdate).toBeUndefined();

    const partial = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], version: "2.15.0", migrations: [] });
    await setupApply(["--json", "--only", "path.link"], {}, partial);
    expect(readSetupState(partial.probes).lastUpdate).toBeUndefined();
  });

  test("a finish blocker left standing keeps setup unfinished", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], planForFinish: async () => ({ finishBlockedBy: ["tool.fast-browser-extension"] }) });
    await setupApply(["--json"], {}, deps);
    expect(finished(deps.probes)).toBe(false);
  });

  test("a failed run records nothing", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "failed", detail: "boom" })] });
    await runExpectingExit(() => setupApply(["--json"], {}, deps));
    expect(finished(deps.probes)).toBe(false);
  });

  test("--only and --from are partial runs and never finish setup", async () => {
    for (const flag of ["--only", "--from"]) {
      let asked = false;
      const deps = baseApplyDeps({
        steps: [fakeStep("path.link", { state: "done" })],
        planForFinish: async () => {
          asked = true;
          return { finishBlockedBy: [] };
        },
      });
      await setupApply([flag, "path.link", "--json"], {}, deps);
      expect(finished(deps.probes)).toBe(false);
      expect(asked).toBe(false);
    }
  });

  test("a gate that cannot be read leaves setup unfinished and says so on stderr, never on the stream", async () => {
    const errors: string[] = [];
    const deps = baseApplyDeps({
      steps: [fakeStep("path.link", { state: "done" })],
      planForFinish: async () => {
        throw new Error("keychain locked");
      },
      printError: (s) => errors.push(s),
    });
    await setupApply(["--json"], {}, deps);
    expect(finished(deps.probes)).toBe(false);
    expect(errors.join("\n")).toContain("keychain locked");
    expect(deps.lines.every((l) => JSON.parse(l).event !== undefined)).toBe(true);
  });
});

describe("setupApply — hard-precondition gate", () => {
  test("refuses before any step when tool.clt is missing", async () => {
    const deps = baseApplyDeps({ steps: [neverRunsStep("home.init")], planForGate: async () => ({ requiredMissing: ["tool.clt"] }) });

    await runExpectingExit(() => setupApply(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const payload = JSON.parse(deps.lines[0]!) as { error: { message: string } };
    expect(payload.error.message).toContain("blocked by: tool.clt");
    expect(payload.error.message).toContain("xcode-select --install");
  });

  test("non-hard requiredMissing rows (herdr) do not block a headless apply", async () => {
    const deps = baseApplyDeps({
      steps: [fakeStep("path.link", { state: "done", detail: "ok" })],
      planForGate: async () => ({ requiredMissing: ["tool.herdr", "tool.claude"] }),
    });

    await setupApply(["--json"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
  });

  test("--force bypasses the gate without composing a plan", async () => {
    const deps = baseApplyDeps({
      steps: [fakeStep("path.link", { state: "done", detail: "ok" })],
      planForGate: async () => {
        throw new Error("planForGate must not run under --force");
      },
    });

    await setupApply(["--json", "--force"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
  });
});

describe("setup apply --json bytes", () => {
  test("the NDJSON stream is one compact object per line, newline-terminated, nothing else on stdout", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done", detail: "ok" })], json: realJson });
      await setupApply(["--json"], {}, deps);
      expect(cap.stdout()).toBe(
        '{"event":"plan","steps":[{"id":"path.link","title":"path.link","kind":"rt"}]}\n' +
          '{"event":"step","id":"path.link","state":"running"}\n' +
          '{"event":"step","id":"path.link","state":"done","detail":"ok"}\n' +
          '{"event":"done","ok":true}\n',
      );
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
    }
  });

  test("an exit-2 envelope is one line: contract, at, error.code, error.message, in that order", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], json: realJson });
      await runExpectingExit(() => setupApply(["--json", "--from", "bogus"], {}, deps));
      const payload = expectOneJsonLine(cap.stdout()) as { contract: number; at: string; error: { code: string; message: string } };
      expect(Object.keys(payload)).toEqual(["contract", "at", "error"]);
      expect(Object.keys(payload.error)).toEqual(["code", "message"]);
      expect(payload.at).toBe("2026-01-01T00:00:00.000Z");
      expect(payload.error.code).toBe("unknown-step");
      expect(payload.error.message).toContain("bogus");
    } finally {
      cap.restore();
    }
  });
});
