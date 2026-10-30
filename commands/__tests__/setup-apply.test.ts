import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import * as background from "../../lib/ui/background.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";
import { logsDir } from "../../lib/rt-paths.ts";
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
import { isSetupFinished, readSetupState, updateSetupState } from "../../lib/setup/state.ts";
import { applyEventsPath } from "../../lib/setup/apply-run.ts";
import { __test__ as closedPipes } from "../../lib/setup/closed-pipes.ts";
import { createUpdateLock, lockHeldByLiveRun } from "../../lib/setup/update-lock.ts";
import type { RelayClient } from "../../lib/team/relay-client.ts";
import type { SecretsSeams } from "../../lib/secrets/store.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import { UserActionableError } from "../../lib/errors.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { capturePlain, expectOneJsonLine, realJson } from "./helpers/json-line.ts";

let quiet: CapturedOut;
beforeEach(() => {
  quiet = capturePlain();
});
afterEach(() => quiet.restore());

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

describe("setupApply: NDJSON discipline", () => {
  test("--json: stdout lines parse as plan, step, step, done for one done stub step", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done", detail: "ok" })] });

    await setupApply(["--json"], {}, deps);

    // Every line is valid, self-contained JSON: the NDJSON contract's own
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

  test("human mode prints the step's title and a summary, never JSON or the id", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [{ ...fakeStep("path.link", { state: "done", detail: "ok" }), title: "Link rt onto your PATH" }] });
      await setupApply([], {}, deps);
      expect(cap.stdout()).toBe("[ok] Link rt onto your PATH  ok\n[ok] Setup is done  1 done\n");
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
    }
  });

  test("the summary is printed before exit 2", async () => {
    const cap = capturePlain();
    try {
      let atExit = "";
      const deps = baseApplyDeps({ steps: [{ ...fakeStep("path.link", { state: "failed", detail: "boom" }), title: "Link rt onto your PATH" }] });
      deps.exit = ((code: number) => {
        atExit = cap.stdout();
        deps.exitCodes.push(code);
        throw new Error("exit sentinel");
      }) as ApplyDeps["exit"];
      await runExpectingExit(() => setupApply([], {}, deps));
      expect(deps.exitCodes).toEqual([2]);
      expect(atExit).toBe("[failed] Link rt onto your PATH  boom\n[failed] Setup stopped  1 failed\n");
    } finally {
      cap.restore();
    }
  });
});

describe("setupApply: exit-code table", () => {
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
    expect(deps.exitCodes).toEqual([]); // deps.exit is never called for a bug; it propagates instead
  });

  test("createApplyContext throwing a real bug rethrows past setupApply exactly like a step bug does", async () => {
    const deps = baseApplyDeps();
    deps.probes = { ...deps.probes, readDir: () => { throw new Error("readDir boom"); } };

    await expect(setupApply(["--json"], {}, deps)).rejects.toThrow("readDir boom");
    expect(deps.exitCodes).toEqual([]);
    expect(deps.lines).toEqual([]); // nothing reached the stream before the throw
  });

  test("createApplyContext throwing a UserActionableError prints the same exit-2 envelope a step failure gets, never a silently swallowed dead stream", async () => {
    const deps = baseApplyDeps();
    deps.probes = { ...deps.probes, readDir: () => { throw new UserActionableError("team-discovery-failed", "readDir boom"); } };

    // createApplyContext's discoverOrgs() calls p.readDir... this proves a
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
    const gatedOut: StepDef = { id: "home.init", title: "home.init", kind: "rt", applies: () => false, run: async () => { throw new Error("must never run: gated out"); } };
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

describe("setupApply: flags reach the engine", () => {
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

describe("setupApply: --unattended", () => {
  test("--unattended reaches the context", async () => {
    const replies: unknown[] = [];
    const step = (args: string[]) =>
      setupApply(args, {}, baseApplyDeps({
        steps: [
          {
            id: "proxy.install",
            title: "x",
            kind: "privileged",
            applies: () => true,
            run: async (ctx) => {
              replies.push(await ctx.need("proxy.install", { type: "app-privileged", op: "proxy-install" }));
              return { state: "done" };
            },
          },
        ],
      }));

    await step(["--json", "--unattended"]);

    expect(replies).toEqual(["unattended"]);
  });
});

describe("setupInteractive: TTY-vs-json branch", () => {
  const readyExec: ExecScript = (argv) => (argv[0] === "sw_vers" ? ok("15.6") : ok());

  test("non-TTY behaves as `setup status`: prints the plan groups, never confirms", async () => {
    const deps = baseApplyDeps({ isTTY: () => false, probes: fakeProbes({ exec: readyExec }) });
    const cap = capturePlain();
    try {
      await setupInteractive([], {}, deps);
      expect(cap.stdout()).toContain("Your Mac (");
    } finally {
      cap.restore();
    }

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

    const cap = capturePlain();
    try {
      await runExpectingExit(() => setupInteractive([], {}, deps));
      expect(cap.stderr()).toStartWith("This Mac is not ready to install yet");
      expect(cap.stderr()).toContain("  why: Waiting on ");
    } finally {
      cap.restore();
    }

    expect(deps.exitCodes).toEqual([2]);
    expect(deps.confirmCalls).toEqual([]);
  });

  // `--force` bypasses the canInstall gate deterministically. A real
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

    const cap = capturePlain();
    try {
      await setupInteractive(["--force"], {}, deps);
    } finally {
      cap.restore();
    }

    // `confirm` is overridden above (to resolve false), which bypasses the
    // default's own confirmCalls tracking; the real proof a decline works
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

    const cap = capturePlain();
    try {
      await setupInteractive(["--force"], {}, deps);
    } finally {
      cap.restore();
    }

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
        files: { "/fake-home/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc": "{}" },
        dirs: { "/fake-home/.mattstack/orgs": ["acme"] },
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

  test("a stamp that cannot be written is logged and does not fail the run", async () => {
    const probes = fakeProbes();
    const realWrite = probes.writeFile.bind(probes);
    let writes = 0;
    probes.writeFile = (path, content, mode) => {
      if (path.includes("setup-state.json") && ++writes > 1) throw new Error("disk full");
      return realWrite(path, content, mode);
    };
    const deps = baseApplyDeps({ probes, steps: [fakeStep("path.link", { state: "done" })], version: "2.15.0", migrations: [] });
    await setupApply(["--json"], {}, deps);
    expect(deps.exitCodes).toEqual([]);
    for (const line of deps.lines) expect(JSON.parse(line).event).toBeDefined();
    expect(quiet.stdout()).toBe("");
    expect(quiet.stderr()).toBe("");
    const log = readdirSync(logsDir()).filter((f) => f.startsWith("cli.")).map((f) => readFileSync(`${logsDir()}/${f}`, "utf8")).join("");
    expect(log).toContain("disk full");
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

  test("an --only run fixes one row and never finishes setup", async () => {
    let asked = false;
    const deps = baseApplyDeps({
      steps: [fakeStep("path.link", { state: "done" })],
      planForFinish: async () => {
        asked = true;
        return { finishBlockedBy: [] };
      },
    });
    await setupApply(["--only", "path.link", "--json"], {}, deps);
    expect(finished(deps.probes)).toBe(false);
    expect(asked).toBe(false);
  });

  test("a resumed run that ends ok finishes setup when nothing blocks it", async () => {
    const probes = fakeProbes();
    updateSetupState(probes, (s) => ({ ...s, run: { startedAt: "2025-12-31T23:00:00.000Z", done: ["home.init"] } }));
    const deps = baseApplyDeps({ probes, steps: [neverRunsStep("home.init"), fakeStep("path.link", { state: "done" })], version: "2.15.0", migrations: [] });

    await setupApply(["--resume", "--json"], {}, deps);

    expect(finished(probes)).toBe(true);
    expect(readSetupState(probes).lastUpdate?.version).toBe("2.15.0");
  });

  test("a retry from a step finishes setup too", async () => {
    const probes = fakeProbes();
    updateSetupState(probes, (s) => ({ ...s, run: { startedAt: "x", done: ["home.init"], endedAt: "y", ok: false, failed: { step: "path.link", detail: "boom" } } }));
    const deps = baseApplyDeps({ probes, steps: [neverRunsStep("home.init"), fakeStep("path.link", { state: "done" })], version: "2.15.0", migrations: [] });

    await setupApply(["--from", "path.link", "--json"], {}, deps);

    expect(finished(probes)).toBe(true);
    expect(readSetupState(probes).lastUpdate?.version).toBe("2.15.0");
  });

  test("a retry that fails again finishes nothing", async () => {
    const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "failed", detail: "boom" })] });
    await runExpectingExit(() => setupApply(["--from", "path.link", "--json"], {}, deps));
    expect(finished(deps.probes)).toBe(false);
  });

  // The app starts a Retry or reads the form the moment `done` arrives; neither may race these writes.
  test("setup is finished before the app hears the run is done, and the lock is free by then", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-apply-finish-"));
    try {
      const lockPath = join(dir, "setup-apply.lock");
      const seen: { finished: boolean; lockFree: boolean }[] = [];
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], runLock: createUpdateLock(lockPath, { pid: 222, alive: () => true }) });
      const json = deps.json;
      deps.json = (v) => {
        json(v);
        if ((v as ApplyEvent).event === "done") seen.push({ finished: finished(deps.probes), lockFree: !existsSync(lockPath) });
      };

      await setupApply(["--json"], {}, deps);

      expect(seen).toEqual([{ finished: true, lockFree: true }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a finish check that throws under --json reaches the log, never stdout", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], planForFinish: async () => { throw new Error("keychain locked"); }, json: realJson });
      await setupApply(["--json"], {}, deps);
      expect(finished(deps.probes)).toBe(false);
      for (const line of cap.stdout().trim().split("\n")) expect(JSON.parse(line).event).toBeDefined();
      expect(cap.stderr()).toBe("");
      const log = readdirSync(logsDir()).filter((f) => f.startsWith("cli.")).map((f) => readFileSync(`${logsDir()}/${f}`, "utf8")).join("");
      expect(log).toContain("keychain locked");
    } finally {
      cap.restore();
    }
  });

  test("a finish check that throws for a person is a warning line on stdout", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })], planForFinish: async () => { throw new Error("keychain locked"); } });
      await setupApply([], {}, deps);
      expect(cap.stdout()).toContain("[warning] Setup was left unfinished because the finish check failed  keychain locked\n");
    } finally {
      cap.restore();
    }
  });
});

describe("setupApply: one run, recorded, resumed or attached", () => {
  let dir: string;
  let lockPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-apply-run-"));
    lockPath = join(dir, "setup-apply.lock");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const EVENTS = applyEventsPath("/fake-home");
  const lock = (pid: number) => createUpdateLock(lockPath, { pid, alive: () => true });
  const holderAlive = () => lockHeldByLiveRun(lockPath, { alive: () => true });
  const events = (deps: { lines: string[] }) => deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
  const flow = (evs: ApplyEvent[]) => evs.map((e) => (e.event === "step" ? `${e.id} ${e.state}` : e.event));
  const runOf = (probes: ReturnType<typeof fakeProbes>) => readSetupState(probes).run;

  /** A step that waits for the test to let it finish, so a second run can start while the first is alive. */
  function heldStep(id: StepId): { step: StepDef; started: Promise<void>; finish: () => void } {
    let finish!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((r) => (markStarted = r));
    const gate = new Promise<void>((r) => (finish = r));
    return {
      step: fakeStep(id, async () => {
        markStarted();
        await gate;
        return { state: "done" };
      }),
      started,
      finish,
    };
  }

  test("--resume with no record runs everything", async () => {
    const ran: string[] = [];
    const step = (id: StepId) => fakeStep(id, async () => { ran.push(id); return { state: "done" }; });
    const deps = baseApplyDeps({ steps: [step("home.init"), step("path.link")], runLock: lock(222), holderAlive });

    await setupApply(["--resume", "--json"], {}, deps);

    expect(ran).toEqual(["home.init", "path.link"]);
    expect(runOf(deps.probes)).toMatchObject({ done: ["home.init", "path.link"], ok: true });
    expect(existsSync(lockPath)).toBe(false);
  });

  test("--resume after a run died runs only what was left, marking the rest done first", async () => {
    const probes = fakeProbes();
    updateSetupState(probes, (s) => ({ ...s, run: { startedAt: "2025-12-31T23:00:00.000Z", done: ["home.init", "path.link"] } }));
    expect(lock(111).acquire()).toBe(true);
    const deadIsGone = (pid: number) => pid !== 111;
    let resumedRan = false;
    const deps = baseApplyDeps({
      probes,
      steps: [neverRunsStep("home.init"), neverRunsStep("path.link"), fakeStep("verify", async () => { resumedRan = true; return { state: "done" }; })],
      runLock: createUpdateLock(lockPath, { pid: 222, alive: deadIsGone }),
      holderAlive: () => lockHeldByLiveRun(lockPath, { alive: deadIsGone }),
    });

    await setupApply(["--resume", "--json"], {}, deps);

    expect(resumedRan).toBe(true);
    expect(flow(events(deps))).toEqual(["plan", "home.init done", "path.link done", "verify running", "verify done", "done"]);
    expect(events(deps)[1]).toEqual({ event: "step", id: "home.init", state: "done" });
    expect(runOf(probes)).toEqual({ startedAt: "2025-12-31T23:00:00.000Z", done: ["home.init", "path.link", "verify"], endedAt: "2026-01-01T00:00:00.000Z", ok: true });
    expect(deps.exitCodes).toEqual([]);
  });

  test("a --resume while the run's holder lives attaches and starts nothing", async () => {
    expect(lock(111).acquire()).toBe(true);
    const replay: ApplyEvent[] = [
      { event: "plan", steps: [{ id: "home.init", title: "home.init", kind: "rt" }] },
      { event: "step", id: "home.init", state: "running" },
      { event: "step", id: "home.init", state: "done" },
      { event: "done", ok: true },
    ];
    const probes = fakeProbes({ files: { [EVENTS]: replay.map((e) => `${JSON.stringify(e)}\n`).join("") } });
    const deps = baseApplyDeps({ probes, steps: [neverRunsStep("home.init")], runLock: lock(222), holderAlive, planForGate: async () => { throw new Error("an attach composes no plan"); } });

    await setupApply(["--resume", "--json"], {}, deps);

    expect(events(deps)).toEqual(replay);
    expect(deps.exitCodes).toEqual([]);
    expect(readFileSync(lockPath, "utf8")).toBe("111");
    expect(probes.readFile(EVENTS)).toBe(replay.map((e) => `${JSON.stringify(e)}\n`).join(""));
  });

  test("an attach whose run failed exits 2", async () => {
    expect(lock(111).acquire()).toBe(true);
    const replay: ApplyEvent[] = [{ event: "plan", steps: [] }, { event: "done", ok: false, failedStep: "home.init" }];
    const probes = fakeProbes({ files: { [EVENTS]: replay.map((e) => `${JSON.stringify(e)}\n`).join("") } });
    const deps = baseApplyDeps({ probes, steps: [neverRunsStep("home.init")], runLock: lock(222), holderAlive });

    await runExpectingExit(() => setupApply(["--resume", "--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(events(deps)).toEqual(replay);
  });

  test("a second full run while one is alive is refused", async () => {
    expect(lock(111).acquire()).toBe(true);
    for (const args of [["--json"], ["--json", "--from", "home.init"]]) {
      const deps = baseApplyDeps({ steps: [neverRunsStep("home.init")], runLock: lock(222), holderAlive });

      await runExpectingExit(() => setupApply(args, {}, deps));

      expect(deps.exitCodes).toEqual([2]);
      expect(deps.lines).toHaveLength(1);
      const payload = JSON.parse(deps.lines[0]!) as { error: { code: string; message: string } };
      expect(payload.error).toEqual({ code: "run-busy", message: "Setup is already running" });
      expect(readFileSync(lockPath, "utf8")).toBe("111");
    }
  });

  test("a refused run tells a person how to follow the one already running", async () => {
    expect(lock(111).acquire()).toBe(true);
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [neverRunsStep("home.init")], runLock: lock(222), holderAlive });
      await runExpectingExit(() => setupApply([], {}, deps));
      expect(cap.stderr()).toBe("Setup is already running\n  next: rt setup apply --resume\n");
    } finally {
      cap.restore();
    }
  });

  test("a run whose stdout closed keeps going and records every step", async () => {
    const ran: string[] = [];
    const step = (id: StepId) => fakeStep(id, async () => { ran.push(id); return { state: "done" }; });
    let writes = 0;
    const deps = baseApplyDeps({
      steps: [step("home.init"), step("path.link"), step("verify")],
      runLock: lock(222),
      holderAlive,
      json: () => {
        if (++writes > 1) throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      },
    });

    await setupApply(["--json"], {}, deps);

    expect(ran).toEqual(["home.init", "path.link", "verify"]);
    expect(runOf(deps.probes)).toMatchObject({ done: ["home.init", "path.link", "verify"], ok: true });
    expect(flow(deps.probes.readFile(EVENTS)!.trim().split("\n").map((l) => JSON.parse(l) as ApplyEvent))).toEqual([
      "plan",
      "home.init running",
      "home.init done",
      "path.link running",
      "path.link done",
      "verify running",
      "verify done",
      "done",
    ]);
    expect(deps.exitCodes).toEqual([]);
  });

  test("a Retry records continue: it keeps what was done and an ok Retry clears the pause", async () => {
    const probes = fakeProbes();
    updateSetupState(probes, (s) => ({
      ...s,
      run: { startedAt: "2025-12-31T23:00:00.000Z", done: ["home.init"], endedAt: "2025-12-31T23:10:00.000Z", ok: false, failed: { step: "repos.clone", detail: "Couldn't clone acme-api" } },
    }));
    const deps = baseApplyDeps({ probes, steps: [neverRunsStep("home.init"), fakeStep("repos.clone", { state: "done" }), fakeStep("verify", { state: "done" })], runLock: lock(222), holderAlive });

    await setupApply(["--json", "--from", "repos.clone"], {}, deps);

    expect(runOf(probes)).toEqual({ startedAt: "2025-12-31T23:00:00.000Z", done: ["home.init", "repos.clone", "verify"], endedAt: "2026-01-01T00:00:00.000Z", ok: true });
  });

  test("a Retry started on the done event is never refused", async () => {
    const retryTookLock: boolean[] = [];
    const deps = baseApplyDeps({ steps: [fakeStep("repos.clone", { state: "failed", detail: "boom" })], runLock: lock(222), holderAlive });
    const json = deps.json;
    deps.json = (v) => {
      json(v);
      if ((v as ApplyEvent).event !== "done") return;
      const retry = lock(333);
      retryTookLock.push(retry.acquire());
      retry.release();
    };

    await runExpectingExit(() => setupApply(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(retryTookLock).toEqual([true]);
  });

  test("a --resume while a Retry's holder lives attaches", async () => {
    const probes = fakeProbes();
    updateSetupState(probes, (s) => ({ ...s, run: { startedAt: "x", done: ["home.init"], endedAt: "y", ok: false, failed: { step: "repos.clone", detail: "boom" } } }));
    const held = heldStep("repos.clone");
    const retry = baseApplyDeps({ probes, steps: [neverRunsStep("home.init"), held.step], runLock: lock(222), holderAlive });
    const retrying = setupApply(["--json", "--from", "repos.clone"], {}, retry);
    await held.started;

    const resume = baseApplyDeps({
      probes,
      steps: [neverRunsStep("home.init"), neverRunsStep("repos.clone")],
      runLock: lock(333),
      holderAlive,
      attachSleep: async () => {
        held.finish();
        await retrying;
      },
    });
    await setupApply(["--resume", "--json"], {}, resume);

    expect(flow(events(resume))).toEqual(flow(events(retry)));
    expect(flow(events(resume))).toEqual(["plan", "repos.clone running", "repos.clone done", "done"]);
    expect(resume.exitCodes).toEqual([]);
    expect(runOf(probes)).toMatchObject({ done: ["home.init", "repos.clone"], ok: true });
  });

  // P1's Allow runs `--only proxy.install`, and a leftover row runs its own
  // step the same way: neither is the bar's run, so neither takes the lock.
  test("an --only run is never refused by a lock whose holder is gone, and leaves the record and the events alone", async () => {
    createUpdateLock(lockPath, { pid: 111, alive: () => true }).acquire();
    const probes = fakeProbes({ files: { [EVENTS]: "the bar's last run\n" } });
    const before = { startedAt: "x", done: ["home.init" as const], endedAt: "y", ok: false, failed: { step: "repos.clone" as const, detail: "boom" } };
    updateSetupState(probes, (s) => ({ ...s, run: before }));
    const deps = baseApplyDeps({ probes, steps: [fakeStep("proxy.install", { state: "done" })], runLock: lock(222), holderAlive: () => lockHeldByLiveRun(lockPath, { alive: () => false }) });

    await setupApply(["--json", "--only", "proxy.install"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
    expect(runOf(probes)).toEqual(before);
    expect(probes.readFile(EVENTS)).toBe("the bar's last run\n");
    expect(readFileSync(lockPath, "utf8")).toBe("111");
  });

  test("an --only run while the bar's run is alive is refused", async () => {
    expect(lock(111).acquire()).toBe(true);
    const deps = baseApplyDeps({ steps: [neverRunsStep("proxy.install")], runLock: lock(222), holderAlive });

    await runExpectingExit(() => setupApply(["--json", "--only", "proxy.install"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect((JSON.parse(deps.lines[0]!) as { error: { code: string } }).error.code).toBe("run-busy");
  });

  test("--resume with --from or --only is refused before anything runs", async () => {
    for (const flag of ["--from", "--only"]) {
      const deps = baseApplyDeps({ steps: [neverRunsStep("home.init")], runLock: lock(222), holderAlive });
      await runExpectingExit(() => setupApply(["--json", "--resume", flag, "home.init"], {}, deps));
      expect(deps.exitCodes).toEqual([2]);
      expect((JSON.parse(deps.lines[0]!) as { error: { code: string } }).error.code).toBe("bad-args");
      expect(existsSync(lockPath)).toBe(false);
    }
  });

  test("a run the gate refuses lets go of the lock", async () => {
    const deps = baseApplyDeps({ steps: [neverRunsStep("home.init")], runLock: lock(222), holderAlive, planForGate: async () => ({ requiredMissing: ["tool.clt"] }) });
    await runExpectingExit(() => setupApply(["--json"], {}, deps));
    expect(deps.exitCodes).toEqual([2]);
    expect(existsSync(lockPath)).toBe(false);
  });
});

// When the app quits, both of its child's pipes close and every later write
// fails with an async error event; with no listener, Bun ends the run there.
describe("setupApply --json outlives the app that spawned it", () => {
  const errorListeners = () => [process.stdout.listenerCount("error"), process.stderr.listenerCount("error")];
  beforeEach(() => closedPipes.reset());
  afterEach(() => closedPipes.reset());

  test("--json listens for errors on both pipes, once however many runs", async () => {
    const before = errorListeners();

    await setupApply(["--json"], {}, baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })] }));
    await setupApply(["--json"], {}, baseApplyDeps({ steps: [fakeStep("path.link", { state: "done" })] }));

    expect(errorListeners()).toEqual([before[0]! + 1, before[1]! + 1]);
  });
});

describe("setupApply: hard-precondition gate", () => {
  test("refuses before any step when tool.clt is missing", async () => {
    const deps = baseApplyDeps({ steps: [neverRunsStep("home.init")], planForGate: async () => ({ requiredMissing: ["tool.clt"] }) });

    await runExpectingExit(() => setupApply(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const payload = JSON.parse(deps.lines[0]!) as { error: { message: string } };
    expect(payload.error.message).toBe("This Mac is not ready to install yet: Apple's Command Line Tools are not installed");
  });

  test("for a person the hard gate is a failure block with plain words and the install verb to run", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [neverRunsStep("home.init")], planForGate: async () => ({ requiredMissing: ["tool.clt"] }) });
      await runExpectingExit(() => setupApply([], {}, deps));
      expect(deps.exitCodes).toEqual([2]);
      expect(cap.stdout()).toBe("");
      expect(cap.stderr()).toBe("This Mac is not ready to install yet\n  why: Apple's Command Line Tools are not installed\n  next: rt tools install apple-clt\n");
    } finally {
      cap.restore();
    }
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

  test("--only proxy.install skips the hard-precondition gate", async () => {
    const deps = baseApplyDeps({
      steps: [fakeStep("proxy.install", { state: "done", detail: "ok" })],
      planForGate: async () => {
        throw new Error("planForGate must not run for --only proxy.install");
      },
    });

    await setupApply(["--json", "--only", "proxy.install"], {}, deps);

    expect(deps.exitCodes).toEqual([]);
  });

  test("a full run still refuses without Command Line Tools", async () => {
    const deps = baseApplyDeps({ steps: [neverRunsStep("proxy.install")], planForGate: async () => ({ requiredMissing: ["tool.clt"] }) });

    await runExpectingExit(() => setupApply(["--json"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
  });
});

describe("setup apply --json bytes", () => {
  test("the NDJSON stream is one compact object per line, newline-terminated, nothing else on stdout", async () => {
    const cap = capturePlain();
    try {
      const deps = baseApplyDeps({ steps: [fakeStep("path.link", { state: "done", detail: "ok" })], json: realJson });
      await setupApply(["--json"], {}, deps);
      expect(cap.stdout()).toBe(
        '{"event":"plan","steps":[{"id":"path.link","title":"path.link","kind":"rt","phase":"Setting up rt","weight":1,"paused":"Couldn\'t set up rt"}]}\n' +
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

describe("setupApply: the background settles before any step runs", () => {
  const preloadBlock = process.env.RT_UI_NO_TERMINAL_QUERY;
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-setup-settle-"));
    delete process.env.RT_UI_NO_TERMINAL_QUERY;
    background.__test__.reset();
    background.__test__.setTTY(() => true);
    gate.setInteractive(() => true);
    process.env.RT_UI_BIN = resolve(import.meta.dir, "../../lib/ui/__tests__/fake-rt-ui.ts");
  });
  afterEach(() => {
    process.env.RT_UI_NO_TERMINAL_QUERY = preloadBlock;
    background.__test__.reset();
    gate.setInteractive(undefined);
    delete process.env.RT_UI_BIN;
    delete process.env.RT_UI_FAKE;
    rmSync(dir, { recursive: true, force: true });
  });

  test("the auto query finishes before the first step's work starts", async () => {
    const record = join(dir, "record.ndjson");
    process.env.RT_UI_FAKE = JSON.stringify({ record, renderErr: "background=dark\n" });
    const deps = baseApplyDeps({
      steps: [fakeStep("path.link", async () => {
        appendFileSync(record, `{"work":"started"}\n`);
        return { state: "done" };
      })],
    });
    await setupApply([], {}, deps);
    const lines = readFileSync(record, "utf8").split("\n");
    const settled = lines.findIndex((l) => l.startsWith(`{"argv":["--report-background"]`));
    expect(settled).toBeGreaterThanOrEqual(0);
    expect(settled).toBeLessThan(lines.indexOf(`{"work":"started"}`));
  });

  test("under the test preload no query runs", async () => {
    process.env.RT_UI_NO_TERMINAL_QUERY = preloadBlock;
    const record = join(dir, "record.ndjson");
    process.env.RT_UI_FAKE = JSON.stringify({ record, renderErr: "background=dark\n" });
    const deps = baseApplyDeps({
      steps: [fakeStep("path.link", async () => {
        appendFileSync(record, `{"work":"started"}\n`);
        return { state: "done" };
      })],
    });
    await setupApply([], {}, deps);
    expect(readFileSync(record, "utf8")).not.toContain(`"--report-background"`);
  });
});
