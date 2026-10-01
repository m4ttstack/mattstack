import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import type { SecretsSeams } from "../../secrets/store.ts";
import type { RelayClient } from "../../team/relay-client.ts";
import type { ApplyContext, StepDef, StepOutcome } from "../apply.ts";
import { createApplyContext, outcomeFromNeed, runApplyWith, runUpdateWith } from "../apply.ts";
import type { MigrationDef } from "../migrations/index.ts";
import type { Emit } from "../emit.ts";
import type { ApplyEvent, StepId } from "../contract.ts";
import { STEP_IDS } from "../contract.ts";
import { UserActionableError } from "../../errors.ts";
import type { Probes } from "../probes.ts";
import { STEPS } from "../steps/index.ts";
import { fakeProbes, fakeTray } from "./fakes.ts";
import { needOutcome } from "../steps/step-utils.ts";
import { isSetupFinished, readSetupState, updateSetupState } from "../state.ts";

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

const fakeTeamSecrets = (): SecretsSeams => fakeSecrets;

const fakeRelay: RelayClient = {
  create: async () => ({ id: "", creatorSecret: "" }),
  fetch: async () => "gone",
  redeem: async () => "already",
  reply: async () => {},
  readReply: async () => "none",
  delete: async () => {},
};

function testCtx(overrides: Partial<ApplyContext> = {}): { ctx: ApplyContext; events: ApplyEvent[] } {
  const events: ApplyEvent[] = [];
  const p = fakeProbes();
  const emit: Emit = overrides.emit ?? ((ev) => events.push(ev));
  const ctx: ApplyContext = {
    p,
    emit,
    log(id, line) {
      emit({ event: "log", id, line });
    },
    intent: null,
    team: { slug: "acme", name: "Acme", mode: "none" },
    snapshot: null,
    reqs: [],
    nonInteractive: false,
    teamOfOne: false,
    appPath: null,
    ci: false,
    secrets: fakeSecrets,
    teamSecrets: fakeTeamSecrets,
    relay: fakeRelay,
    secretPresence: { has: async () => null },
    redact: () => {},
    async need() {
      return "app-gone";
    },
    ...overrides,
  };
  return { ctx, events };
}

function fakeStep(id: StepId, outcome: StepOutcome | (() => Promise<StepOutcome>), opts: { applies?: boolean } = {}): StepDef {
  return {
    id,
    title: id,
    kind: "rt",
    applies: () => opts.applies ?? true,
    run: typeof outcome === "function" ? outcome : async () => outcome,
  };
}

function throwingStep(id: StepId, err: unknown): StepDef {
  return {
    id,
    title: id,
    kind: "rt",
    applies: () => true,
    run: async () => {
      throw err;
    },
  };
}

describe("runApplyWith — team reload", () => {
  test("a done step marked reloadsTeam re-reads the team for the steps after it (a joiner's clone lands mid-run); a failed one does not", async () => {
    const { ctx } = testCtx();
    let reloads = 0;
    ctx.reloadTeam = () => {
      reloads++;
      ctx.snapshot = { slug: "acme", integrations: {}, trackingIdentities: ["gitlab.com/acme/acme-dev"], marketplaces: [], plugins: [], remote: null };
    };
    const seenByLater: string[][] = [];
    const steps: StepDef[] = [
      { ...fakeStep("team.join", { state: "done" }), reloadsTeam: true },
      fakeStep("repos.clone", async () => {
        seenByLater.push(ctx.snapshot?.trackingIdentities ?? []);
        return { state: "done" };
      }),
    ];

    await runApplyWith(steps, ctx, {});
    expect(reloads).toBe(1);
    expect(seenByLater).toEqual([["gitlab.com/acme/acme-dev"]]);

    const { ctx: ctx2 } = testCtx();
    let reloads2 = 0;
    ctx2.reloadTeam = () => { reloads2++; };
    await runApplyWith([{ ...fakeStep("team.join", { state: "failed", detail: "no" }), reloadsTeam: true }], ctx2, {});
    expect(reloads2).toBe(0);
  });

  test("a partial reloadsTeam step landed its clone too, so the steps after it see the team", async () => {
    const { ctx } = testCtx();
    let reloads = 0;
    ctx.reloadTeam = () => { reloads++; };
    await runApplyWith([{ ...fakeStep("team.join", { state: "partial", detail: "joined, board not peered" }), reloadsTeam: true }], ctx, {});
    expect(reloads).toBe(1);
  });
});

// A Mac with a daemon and no setup files reads as a pre-app install that
// finished. The run's own services.register must not make it look like one.
describe("runApplyWith: the legacy finish is judged before the run installs anything", () => {
  const DAEMON = "/fake-home/.mattstack/rt/daemon.json";
  function steps(probes: ReturnType<typeof fakeProbes>): StepDef[] {
    return [
      fakeStep("services.register", async () => {
        probes.writeFile(DAEMON, "{}");
        return { state: "done" };
      }),
      fakeStep("plugins.install", async () => {
        updateSetupState(probes, (s) => ({ ...s, plugins: ["x"] }));
        return { state: "done" };
      }),
    ];
  }

  test("a fresh Mac stays unfinished after a run installs the daemon", async () => {
    const { ctx } = testCtx();
    const probes = ctx.p as ReturnType<typeof fakeProbes>;
    await runApplyWith(steps(probes), ctx);
    expect(isSetupFinished(readSetupState(probes))).toBe(false);
  });

  test("a Mac whose daemon predates the run keeps its legacy finish", async () => {
    const { ctx } = testCtx();
    const probes = ctx.p as ReturnType<typeof fakeProbes>;
    probes.writeFile(DAEMON, "{}");
    await runApplyWith(steps(probes), ctx);
    expect(isSetupFinished(readSetupState(probes))).toBe(true);
  });
});

// The app reopens an unfinished setup at Done only after a run that got
// through; a failed one (a join clears its intent mid-run) goes back to the
// checklist, where its broken rows are.
describe("runApplyWith: lastApplyOk records whether the last whole run got through", () => {
  const lastApplyOk = (ctx: ApplyContext) => readSetupState(ctx.p as ReturnType<typeof fakeProbes>).lastApplyOk;

  test("a run that ends ok records true, a failed one false", async () => {
    const good = testCtx().ctx;
    await runApplyWith([fakeStep("path.link", { state: "done" })], good);
    expect(lastApplyOk(good)).toBe(true);

    const bad = testCtx().ctx;
    await runApplyWith([fakeStep("path.link", { state: "failed", detail: "boom" })], bad);
    expect(lastApplyOk(bad)).toBe(false);
  });

  test("--from counts, since it runs everything left", async () => {
    const { ctx } = testCtx();
    await runApplyWith([fakeStep("home.init", { state: "done" }), fakeStep("path.link", { state: "failed", detail: "boom" })], ctx, { from: "path.link" });
    expect(lastApplyOk(ctx)).toBe(false);
  });

  test("an --only retry leaves the last whole run's answer alone", async () => {
    const { ctx } = testCtx();
    await runApplyWith([fakeStep("path.link", { state: "failed", detail: "boom" })], ctx);
    await runApplyWith([fakeStep("path.link", { state: "done" })], ctx, { only: "path.link" });
    expect(lastApplyOk(ctx)).toBe(false);
  });
});

describe("runApplyWith — happy path", () => {
  test("three done steps stream plan, running/done per step, then done ok:true", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [
      fakeStep("home.init", { state: "done", detail: "pushed main" }),
      fakeStep("home.restore", { state: "done" }),
      fakeStep("team.create", { state: "done", detail: "created" }),
    ];

    const result = await runApplyWith(steps, ctx, {});

    expect(result).toEqual({ ok: true });
    expect(events).toEqual([
      {
        event: "plan",
        steps: [
          { id: "home.init", title: "home.init", kind: "rt" },
          { id: "home.restore", title: "home.restore", kind: "rt" },
          { id: "team.create", title: "team.create", kind: "rt" },
        ],
      },
      { event: "step", id: "home.init", state: "running" },
      { event: "step", id: "home.init", state: "done", detail: "pushed main" },
      { event: "step", id: "home.restore", state: "running" },
      { event: "step", id: "home.restore", state: "done" },
      { event: "step", id: "team.create", state: "running" },
      { event: "step", id: "team.create", state: "done", detail: "created" },
      { event: "done", ok: true },
    ]);
  });

  test("persists lastApplyAt and clears the intent on a clean run", async () => {
    const { ctx } = testCtx({ intent: { v: 1, at: "x", mode: "create" } });
    (ctx.p as ReturnType<typeof fakeProbes>).writeFile("/fake-home/.mattstack/rt/setup-intent.json", "{}");
    await runApplyWith([fakeStep("home.init", { state: "done" })], ctx, {});

    const state = JSON.parse((ctx.p as ReturnType<typeof fakeProbes>).readFile("/fake-home/.mattstack/rt/setup-state.json")!);
    expect(state.lastApplyAt).toBe(ctx.p.now().toISOString());
    expect((ctx.p as ReturnType<typeof fakeProbes>).readFile("/fake-home/.mattstack/rt/setup-intent.json")).toBeNull();
  });
});

describe("runApplyWith — failure stops the run", () => {
  test("second step fails: third never runs, stream ends with done ok:false failedStep", async () => {
    const { ctx, events } = testCtx();
    let thirdRan = false;
    const steps: StepDef[] = [
      fakeStep("home.init", { state: "done" }),
      fakeStep("home.restore", { state: "failed", detail: "claude plugin install exited 1", remedy: "Open Claude Code once, then Retry." }),
      fakeStep("team.create", async () => {
        thirdRan = true;
        return { state: "done" };
      }),
    ];

    const result = await runApplyWith(steps, ctx, {});

    expect(result).toEqual({ ok: false, failedStep: "home.restore" });
    expect(thirdRan).toBe(false);
    expect(events.at(-2)).toEqual({
      event: "step",
      id: "home.restore",
      state: "failed",
      detail: "claude plugin install exited 1",
      remedy: "Open Claude Code once, then Retry.",
    });
    expect(events.at(-1)).toEqual({ event: "done", ok: false, failedStep: "home.restore" });
  });

  test("lastApplyAt is written even on a run that fails partway through", async () => {
    const { ctx } = testCtx();
    const steps: StepDef[] = [fakeStep("home.init", { state: "done" }), fakeStep("home.restore", { state: "failed", detail: "boom" })];

    await runApplyWith(steps, ctx, {});

    const state = JSON.parse((ctx.p as ReturnType<typeof fakeProbes>).readFile("/fake-home/.mattstack/rt/setup-state.json")!);
    expect(state.lastApplyAt).toBe(ctx.p.now().toISOString());
  });
});

describe("runApplyWith — a state-write failure never suppresses the terminal done event", () => {
  test("writeFile throwing during post-run persistence still yields exactly one done event", async () => {
    const { ctx, events } = testCtx();
    const throwingP: Probes = {
      ...ctx.p,
      writeFile() {
        throw new Error("disk full");
      },
    };
    const brokenCtx: ApplyContext = { ...ctx, p: throwingP };

    const result = await runApplyWith([fakeStep("home.init", { state: "done" })], brokenCtx, {});

    expect(result).toEqual({ ok: true });
    const doneEvents = events.filter((e) => e.event === "done");
    expect(doneEvents).toEqual([{ event: "done", ok: true }]);
    expect(events.some((e) => e.event === "log" && e.id === "home.init" && e.line.includes("disk full"))).toBe(true);
  });

  test("a throw during persistence after a failing step still yields ok:false and one done event", async () => {
    const { ctx, events } = testCtx();
    const throwingP: Probes = {
      ...ctx.p,
      writeFile() {
        throw new Error("disk full");
      },
    };
    const brokenCtx: ApplyContext = { ...ctx, p: throwingP };
    const steps: StepDef[] = [fakeStep("home.init", { state: "failed", detail: "nope" })];

    const result = await runApplyWith(steps, brokenCtx, {});

    expect(result).toEqual({ ok: false, failedStep: "home.init" });
    const doneEvents = events.filter((e) => e.event === "done");
    expect(doneEvents).toEqual([{ event: "done", ok: false, failedStep: "home.init" }]);
  });
});

describe("runApplyWith — thrown errors", () => {
  test("a step throwing UserActionableError becomes a failed step carrying the remedy", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [throwingStep("home.init", new UserActionableError("x", "msg", { remedy: "do y" }))];

    const result = await runApplyWith(steps, ctx, {});

    expect(result).toEqual({ ok: false, failedStep: "home.init" });
    expect(events.at(-2)).toEqual({ event: "step", id: "home.init", state: "failed", detail: "msg", remedy: "do y" });
    expect(events.at(-1)).toEqual({ event: "done", ok: false, failedStep: "home.init" });
  });

  test("a step throwing a plain Error emits a failed step + exactly one done, then rethrows", async () => {
    const { ctx, events } = testCtx();
    const boom = new Error("unexpected");
    const steps: StepDef[] = [throwingStep("home.init", boom)];

    await expect(runApplyWith(steps, ctx, {})).rejects.toBe(boom);
    expect(events.at(-2)).toEqual({ event: "step", id: "home.init", state: "failed", detail: "bug: unexpected" });
    expect(events.at(-1)).toEqual({ event: "done", ok: false, failedStep: "home.init" });
    expect(events.filter((e) => e.event === "done")).toHaveLength(1);
  });

  test("a step throwing a falsy non-Error value (undefined) still rethrows rather than being swallowed", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [throwingStep("home.init", undefined)];

    let caught: unknown = "not-thrown";
    let threw = false;
    try {
      await runApplyWith(steps, ctx, {});
    } catch (err) {
      threw = true;
      caught = err;
    }

    expect(threw).toBe(true);
    expect(caught).toBeUndefined();
    expect(events.at(-2)).toEqual({ event: "step", id: "home.init", state: "failed", detail: "bug: undefined" });
    expect(events.filter((e) => e.event === "done")).toHaveLength(1);
  });
});

describe("runApplyWith: a settings share tip is the step's own log line", () => {
  test("a step's setSetting tip lands as a log event under that step, never on stderr", async () => {
    const origHome = process.env.HOME;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-apply-notice-")));
    process.env.HOME = home;
    const stderr: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => void stderr.push(args.map(String).join(" "));
    try {
      const { ctx, events } = testCtx();
      const steps: StepDef[] = [
        fakeStep("board.keys", async () => {
          setSetting("chat.humanHandle", "acme-dev", "user");
          return { state: "done" };
        }),
      ];

      await runApplyWith(steps, ctx, {});

      const logs = events.filter((e) => e.event === "log");
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ event: "log", id: "board.keys" });
      expect((logs[0] as { line: string }).line).toContain("Saved chat.humanHandle");
      expect(stderr).toEqual([]);
    } finally {
      console.error = origError;
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("runApplyWith — skipped is non-fatal", () => {
  test("a skipped step continues to the next one", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [
      fakeStep("skills.materialize", { state: "skipped", detail: "plugins not installed yet" }),
      fakeStep("plugins.install", { state: "done", detail: "materialized skills too" }),
    ];

    const result = await runApplyWith(steps, ctx, {});

    expect(result).toEqual({ ok: true });
    expect(events).toContainEqual({ event: "step", id: "skills.materialize", state: "skipped", detail: "plugins not installed yet" });
    expect(events).toContainEqual({ event: "step", id: "plugins.install", state: "done", detail: "materialized skills too" });
    expect(events.at(-1)).toEqual({ event: "done", ok: true });
  });
});

describe("runApplyWith: needs-you is non-fatal", () => {
  test("a needs-you step is streamed as such and the run still ends ok", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [
      fakeStep("verify", { state: "needs-you", detail: "to connect: Slack" }),
    ];

    const result = await runApplyWith(steps, ctx, {});

    expect(result).toEqual({ ok: true });
    expect(events).toContainEqual({ event: "step", id: "verify", state: "needs-you", detail: "to connect: Slack" });
    expect(events.at(-1)).toEqual({ event: "done", ok: true });
  });
});

describe("runApplyWith: partial is non-fatal and carries its remedy", () => {
  test("a partial step emits its detail and remedy, and the run goes on to finish ok", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [
      fakeStep("repos.clone", { state: "partial", detail: "cloned 0, present 1, failed 1 (big)", remedy: "retry it" }),
      fakeStep("skills.materialize", { state: "done", detail: "materialized 1, failed 0" }),
    ];

    const result = await runApplyWith(steps, ctx, {});

    expect(result).toEqual({ ok: true });
    expect(events).toContainEqual({ event: "step", id: "repos.clone", state: "partial", detail: "cloned 0, present 1, failed 1 (big)", remedy: "retry it" });
    expect(events).toContainEqual({ event: "step", id: "skills.materialize", state: "done", detail: "materialized 1, failed 0" });
    expect(events.at(-1)).toEqual({ event: "done", ok: true });
  });
});

describe("runApplyWith — --from resume", () => {
  test("resumes at the named step; earlier steps get NO step event and never run", async () => {
    const { ctx, events } = testCtx();
    let firstRan = false;
    const steps: StepDef[] = [
      fakeStep("home.init", async () => {
        firstRan = true;
        return { state: "done" };
      }),
      fakeStep("home.restore", { state: "done" }),
      fakeStep("team.create", { state: "done" }),
    ];

    const result = await runApplyWith(steps, ctx, { from: "home.restore" });

    expect(result).toEqual({ ok: true });
    expect(firstRan).toBe(false);
    expect(events).toEqual([
      {
        event: "plan",
        steps: [
          { id: "home.init", title: "home.init", kind: "rt" },
          { id: "home.restore", title: "home.restore", kind: "rt" },
          { id: "team.create", title: "team.create", kind: "rt" },
        ],
      },
      { event: "step", id: "home.restore", state: "running" },
      { event: "step", id: "home.restore", state: "done" },
      { event: "step", id: "team.create", state: "running" },
      { event: "step", id: "team.create", state: "done" },
      { event: "done", ok: true },
    ]);
    // Never a `step` event for home.init at all — the shipped app preserves
    // a retried run's earlier `done` rows, and a `skipped` event here would
    // overwrite one.
    expect(events.some((e) => e.event === "step" && e.id === "home.init")).toBe(false);
  });

  test("plan lists every step, including the ones before --from", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [fakeStep("home.init", { state: "done" }), fakeStep("home.restore", { state: "done" })];

    await runApplyWith(steps, ctx, { from: "home.restore" });

    expect(events[0]).toEqual({
      event: "plan",
      steps: [
        { id: "home.init", title: "home.init", kind: "rt" },
        { id: "home.restore", title: "home.restore", kind: "rt" },
      ],
    });
  });

  test("an unknown --from id is a user-actionable exit-2 error, never a silent full re-run", async () => {
    const { ctx, events } = testCtx();
    let ran = false;
    const steps: StepDef[] = [
      fakeStep("home.init", async () => {
        ran = true;
        return { state: "done" };
      }),
    ];

    const err = await runApplyWith(steps, ctx, { from: "not-a-real-step-id" as StepId }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as UserActionableError).message).toContain("not-a-real-step-id");
    expect(ran).toBe(false);
    expect(events).toEqual([]); // nothing reaches the stream — this fails before `plan`
  });

  test("a valid --from id gated out by applies() resumes at the first applicable step at-or-after it, not a full restart", async () => {
    const { ctx, events } = testCtx();
    const order: string[] = [];
    const steps: StepDef[] = [
      fakeStep("home.init", async () => {
        order.push("home.init");
        return { state: "done" };
      }),
      fakeStep(
        "home.restore",
        async () => {
          order.push("home.restore");
          return { state: "done" };
        },
        { applies: false },
      ),
      fakeStep("team.create", async () => {
        order.push("team.create");
        return { state: "done" };
      }),
    ];

    const result = await runApplyWith(steps, ctx, { from: "home.restore" });

    expect(result).toEqual({ ok: true });
    expect(order).toEqual(["team.create"]); // never re-runs home.init
    expect(events[0]).toEqual({
      event: "plan",
      steps: [
        { id: "home.init", title: "home.init", kind: "rt" },
        { id: "team.create", title: "team.create", kind: "rt" },
      ],
    });
  });
});

describe("runApplyWith: intercepts.install follows a late feeder", () => {
  /** A clone step whose repo lands only once `reachable` flips, and an intercepts step that records what it saw. */
  function lateCloneHarness() {
    const world = { reachable: false, landed: false, installedFor: [] as boolean[] };
    const clone: StepDef = {
      ...fakeStep("repos.clone", async () => {
        world.landed = world.reachable;
        return world.landed ? { state: "done" } : { state: "partial", detail: "cloned 0, present 0, failed 1 (widgets)" };
      }),
      feedsIntercepts: true,
    };
    const intercepts = fakeStep("intercepts.install", async () => {
      world.installedFor.push(world.landed);
      return { state: "done" };
    });
    return { world, steps: [fakeStep("settings.seed", { state: "done" }), clone, fakeStep("cron.triage", { state: "done" }), intercepts, fakeStep("verify", { state: "done" })] };
  }

  test("a clone that lands on a later --only retry reinstalls the intercepts against it", async () => {
    const { world, steps } = lateCloneHarness();

    await runApplyWith(steps, testCtx().ctx);
    expect(world.installedFor).toEqual([false]);

    world.reachable = true;
    const { ctx, events } = testCtx();
    expect(await runApplyWith(steps, ctx, { only: "repos.clone" })).toEqual({ ok: true });

    expect(world.installedFor).toEqual([false, true]);
    expect(events.filter((e) => e.event === "step").map((e) => `${e.id}:${(e as { state: string }).state}`)).toEqual([
      "repos.clone:running",
      "repos.clone:done",
      "intercepts.install:running",
      "intercepts.install:done",
    ]);
  });

  test("a partial feeder still hands what it landed to intercepts.install", async () => {
    const { world, steps } = lateCloneHarness();

    await runApplyWith(steps, testCtx().ctx, { only: "repos.clone" });

    expect(world.installedFor).toEqual([false]);
  });

  test("a failed feeder does not run intercepts.install", async () => {
    let ran = false;
    const steps: StepDef[] = [
      { ...fakeStep("repos.clone", { state: "failed", detail: "no" }), feedsIntercepts: true },
      fakeStep("intercepts.install", async () => { ran = true; return { state: "done" }; }),
    ];

    expect(await runApplyWith(steps, testCtx().ctx, { only: "repos.clone" })).toEqual({ ok: false, failedStep: "repos.clone" });
    expect(ran).toBe(false);
  });

  test("an --only of a step that feeds nothing runs nothing after it", async () => {
    let ran = false;
    const steps: StepDef[] = [
      fakeStep("proxy.install", { state: "done" }),
      fakeStep("intercepts.install", async () => { ran = true; return { state: "done" }; }),
    ];

    await runApplyWith(steps, testCtx().ctx, { only: "proxy.install" });

    expect(ran).toBe(false);
  });

  test("a failing follow-up intercepts.install fails the run under its own id", async () => {
    const steps: StepDef[] = [
      { ...fakeStep("repos.clone", { state: "done" }), feedsIntercepts: true },
      fakeStep("intercepts.install", { state: "failed", detail: "boom" }),
    ];

    expect(await runApplyWith(steps, testCtx().ctx, { only: "repos.clone" })).toEqual({ ok: false, failedStep: "intercepts.install" });
  });

  test("in the real registry, intercepts.install runs after every step that feeds it", () => {
    const at = (id: StepId) => STEPS.findIndex((s) => s.id === id);
    const feeders = STEPS.filter((s) => s.feedsIntercepts).map((s) => s.id);
    expect(feeders).toEqual(expect.arrayContaining(["team.join", "team.create", "settings.seed", "repos.clone"]));
    for (const id of feeders) expect(at(id)).toBeLessThan(at("intercepts.install"));
  });
});


// The checklist's own row remedies run one step, not "this step and the
// fourteen after it": a `tool.proxy` button labelled "Trust certificate" used
// to reach `snapshot.push`.
describe("runApplyWith: --only", () => {
  test("runs exactly the named step: nothing before it, nothing after it", async () => {
    const { ctx, events } = testCtx();
    const order: string[] = [];
    const steps: StepDef[] = ["home.init", "home.restore", "team.create"].map((id) =>
      fakeStep(id as StepId, async () => {
        order.push(id);
        return { state: "done" };
      }),
    );

    const result = await runApplyWith(steps, ctx, { only: "home.restore" });

    expect(result).toEqual({ ok: true });
    expect(order).toEqual(["home.restore"]);
    expect(events.filter((e) => e.event === "step")).toEqual([
      { event: "step", id: "home.restore", state: "running" },
      { event: "step", id: "home.restore", state: "done" },
    ]);
    // Same rule --from follows: the plan is the whole run, so the app never
    // drops rows it is holding done state for.
    expect(events[0]).toEqual({
      event: "plan",
      steps: [
        { id: "home.init", title: "home.init", kind: "rt" },
        { id: "home.restore", title: "home.restore", kind: "rt" },
        { id: "team.create", title: "team.create", kind: "rt" },
      ],
    });
  });

  test("a failing --only step fails the run and names itself", async () => {
    const { ctx } = testCtx();
    const steps: StepDef[] = [
      fakeStep("home.init", { state: "done" }),
      fakeStep("proxy.install", { state: "failed", detail: "no" }),
    ];

    expect(await runApplyWith(steps, ctx, { only: "proxy.install" })).toEqual({ ok: false, failedStep: "proxy.install" });
  });

  test("an unknown --only id is a user-actionable exit-2 error, and runs nothing", async () => {
    const { ctx, events } = testCtx();
    let ran = false;
    const steps: StepDef[] = [
      fakeStep("home.init", async () => {
        ran = true;
        return { state: "done" };
      }),
    ];

    const err = await runApplyWith(steps, ctx, { only: "not-a-real-step-id" as StepId }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UserActionableError);
    expect((err as UserActionableError).message).toContain("not-a-real-step-id");
    expect(ran).toBe(false);
    expect(events).toEqual([]);
  });

  // Unlike --from, which resumes at the next applicable step, --only names ONE
  // step: running the one that happens to sit at its position would run
  // something nobody asked for.
  test("a valid --only id gated out by applies() runs nothing at all", async () => {
    const { ctx, events } = testCtx();
    const order: string[] = [];
    const steps: StepDef[] = [
      fakeStep("home.init", async () => {
        order.push("home.init");
        return { state: "done" };
      }),
      fakeStep(
        "home.restore",
        async () => {
          order.push("home.restore");
          return { state: "done" };
        },
        { applies: false },
      ),
      fakeStep("team.create", async () => {
        order.push("team.create");
        return { state: "done" };
      }),
    ];

    expect(await runApplyWith(steps, ctx, { only: "home.restore" })).toEqual({ ok: true });
    expect(order).toEqual([]);
    expect(events.some((e) => e.event === "step")).toBe(false);
  });

  // The intent is the in-flight create/join choice the REST of the install
  // still reads. A row's Retry runs one step through --only and leaves every
  // other step still to come, so clearing it here strands them with no team.
  test("a successful --only run keeps the setup intent", async () => {
    const { ctx } = testCtx({ intent: { v: 1, at: "x", mode: "create" } });
    const p = ctx.p as ReturnType<typeof fakeProbes>;
    p.writeFile("/fake-home/.mattstack/rt/setup-intent.json", "{}");

    await runApplyWith([fakeStep("proxy.install", { state: "done" })], ctx, { only: "proxy.install" });

    expect(p.readFile("/fake-home/.mattstack/rt/setup-intent.json")).toBe("{}");
    // Still terminal bookkeeping: the run happened, whatever it narrowed to.
    expect(JSON.parse(p.readFile("/fake-home/.mattstack/rt/setup-state.json")!).lastApplyAt).toBe(ctx.p.now().toISOString());
  });

  // --from is the other half of the same rule: it resumes and then runs
  // everything left, so the run it finishes IS the install.
  test("a successful --from run still clears the intent", async () => {
    const { ctx } = testCtx({ intent: { v: 1, at: "x", mode: "create" } });
    const p = ctx.p as ReturnType<typeof fakeProbes>;
    p.writeFile("/fake-home/.mattstack/rt/setup-intent.json", "{}");

    await runApplyWith([fakeStep("home.init", { state: "done" }), fakeStep("proxy.install", { state: "done" })], ctx, { from: "proxy.install" });

    expect(p.readFile("/fake-home/.mattstack/rt/setup-intent.json")).toBeNull();
  });
});

// A row's Retry runs one step, but some steps cannot land without an earlier
// one: plugins.install reads the team clone team.join makes, which needs the
// home repo home.init makes.
describe("runApplyWith: --only runs unsatisfied prerequisites first", () => {
  function recorder() {
    const order: string[] = [];
    const step = (id: StepId, extra: Partial<StepDef> = {}, outcome: StepOutcome = { state: "done" }): StepDef => ({
      ...fakeStep(id, async () => {
        order.push(id);
        return outcome;
      }),
      ...extra,
    });
    return { order, step };
  }

  function stepStates(events: ApplyEvent[]): string[] {
    return events.filter((e) => e.event === "step").map((e) => `${e.id}:${(e as { state: string }).state}`);
  }

  test("an unsatisfied prerequisite runs before the named step, and both stream their rows", async () => {
    const { order, step } = recorder();
    const steps = [
      step("team.join", { satisfied: () => false }),
      step("repos.clone"),
      step("plugins.install", { prerequisites: ["team.join"] }),
    ];
    const { ctx, events } = testCtx();

    expect(await runApplyWith(steps, ctx, { only: "plugins.install" })).toEqual({ ok: true });

    expect(order).toEqual(["team.join", "plugins.install"]);
    expect(stepStates(events)).toEqual(["team.join:running", "team.join:done", "plugins.install:running", "plugins.install:done"]);
  });

  test("a satisfied prerequisite is left alone", async () => {
    const { order, step } = recorder();
    const steps = [step("team.join", { satisfied: () => true }), step("plugins.install", { prerequisites: ["team.join"] })];

    await runApplyWith(steps, testCtx().ctx, { only: "plugins.install" });

    expect(order).toEqual(["plugins.install"]);
  });

  test("prerequisites chain, and run in registry order whatever order they are listed in", async () => {
    const { order, step } = recorder();
    const steps = [
      step("home.init", { satisfied: () => false }),
      step("team.create", { satisfied: () => false }),
      step("team.join", { satisfied: () => false, prerequisites: ["home.init"] }),
      step("plugins.install", { prerequisites: ["team.join", "team.create"] }),
    ];

    await runApplyWith(steps, testCtx().ctx, { only: "plugins.install" });

    expect(order).toEqual(["home.init", "team.create", "team.join", "plugins.install"]);
  });

  test("a satisfied prerequisite's own prerequisites are not run", async () => {
    const { order, step } = recorder();
    const steps = [
      step("home.init", { satisfied: () => false }),
      step("team.join", { satisfied: () => true, prerequisites: ["home.init"] }),
      step("plugins.install", { prerequisites: ["team.join"] }),
    ];

    await runApplyWith(steps, testCtx().ctx, { only: "plugins.install" });

    expect(order).toEqual(["plugins.install"]);
  });

  test("a prerequisite this run gates out is skipped without a row", async () => {
    const { order, step } = recorder();
    const steps = [
      step("home.init", { satisfied: () => false }),
      step("home.restore", { satisfied: () => false, applies: () => false }),
      step("team.join", { prerequisites: ["home.init", "home.restore"], satisfied: () => false }),
    ];
    const { ctx, events } = testCtx();

    await runApplyWith(steps, ctx, { only: "team.join" });

    expect(order).toEqual(["home.init", "team.join"]);
    expect(stepStates(events).some((s) => s.startsWith("home.restore"))).toBe(false);
  });

  test("a failed prerequisite stops the run before the named step", async () => {
    const { order, step } = recorder();
    const steps = [
      step("team.join", { satisfied: () => false }, { state: "failed", detail: "relay down" }),
      step("plugins.install", { prerequisites: ["team.join"] }),
    ];

    expect(await runApplyWith(steps, testCtx().ctx, { only: "plugins.install" })).toEqual({ ok: false, failedStep: "team.join" });
    expect(order).toEqual(["team.join"]);
  });

  test("a named step this run gates out runs none of its prerequisites either", async () => {
    const { order, step } = recorder();
    const steps = [step("team.join", { satisfied: () => false }), step("plugins.install", { prerequisites: ["team.join"], applies: () => false })];

    await runApplyWith(steps, testCtx().ctx, { only: "plugins.install" });

    expect(order).toEqual([]);
  });

  test("full and --from runs are untouched: every step runs once, in order", async () => {
    const { order, step } = recorder();
    const steps = [
      step("home.init", { satisfied: () => false }),
      step("team.join", { satisfied: () => false, prerequisites: ["home.init"] }),
      step("plugins.install", { prerequisites: ["team.join"] }),
    ];

    await runApplyWith(steps, testCtx().ctx);
    await runApplyWith(steps, testCtx().ctx, { from: "plugins.install" });

    expect(order).toEqual(["home.init", "team.join", "plugins.install", "plugins.install"]);
  });

  test("a prerequisite that feeds the intercepts still hands them its work", async () => {
    const { order, step } = recorder();
    const steps = [
      step("team.join", { satisfied: () => false, feedsIntercepts: true }),
      step("intercepts.install"),
      step("plugins.install", { prerequisites: ["team.join"] }),
    ];

    await runApplyWith(steps, testCtx().ctx, { only: "plugins.install" });

    expect(order).toEqual(["team.join", "intercepts.install", "plugins.install"]);
  });

  // A retry skips the landed feeder as satisfied, so its intercepts must not
  // wait behind a target that can still fail.
  test("a target that fails after a feeder landed still leaves the intercepts installed", async () => {
    const { order, step } = recorder();
    const steps = [
      step("team.join", { satisfied: () => false, feedsIntercepts: true }),
      step("intercepts.install"),
      step("plugins.install", { prerequisites: ["team.join"] }, { state: "failed", detail: "claude missing" }),
    ];

    expect(await runApplyWith(steps, testCtx().ctx, { only: "plugins.install" })).toEqual({ ok: false, failedStep: "plugins.install" });
    expect(order).toEqual(["team.join", "intercepts.install", "plugins.install"]);
  });

  test("a failed prerequisite names itself in its detail, since the row shows the step it ran for", async () => {
    const { step } = recorder();
    const steps = [
      { ...step("team.join", { satisfied: () => false }, { state: "failed", detail: "relay down" }), title: "Join your team" },
      step("plugins.install", { prerequisites: ["team.join"] }),
    ];
    const { ctx, events } = testCtx();

    await runApplyWith(steps, ctx, { only: "plugins.install" });

    expect(events).toContainEqual({ event: "step", id: "team.join", state: "failed", detail: "Join your team: relay down" });
  });

  describe("in the real registry", () => {
    const byId = (id: StepId) => STEPS.find((s) => s.id === id)!;

    test("plugins.install waits on the team clone, and the team on the home repo", () => {
      expect(byId("plugins.install").prerequisites).toEqual(expect.arrayContaining(["team.create", "team.join"]));
      expect(byId("team.join").prerequisites).toEqual(expect.arrayContaining(["home.init", "home.restore"]));
      expect(byId("team.create").prerequisites).toEqual(expect.arrayContaining(["home.init", "home.restore"]));
    });

    test("every prerequisite sits earlier in the registry and can say whether it is satisfied", () => {
      const at = (id: StepId) => STEPS.findIndex((s) => s.id === id);
      for (const s of STEPS) {
        for (const pre of s.prerequisites ?? []) {
          expect(at(pre)).toBeLessThan(at(s.id));
          expect(typeof byId(pre).satisfied).toBe("function");
          // A prerequisite runs inside a row's Retry, where no need is pumped.
          expect(byId(pre).kind).toBe("rt");
        }
      }
    });

    const keySeam = (key: "present" | "absent" | "locked") => ({
      run: async () =>
        key === "present"
          ? { code: 0, stdout: "AGE-SECRET-KEY-1FAKE\n", stderr: "" }
          : key === "absent"
            ? { code: 44, stdout: "", stderr: "security: The specified item could not be found in the keychain." }
            : { code: 36, stdout: "", stderr: "security: user interaction is not allowed" },
    });

    test("the home steps are satisfied only by the clone and its age key together, as home.init's own done check", async () => {
      for (const id of ["home.init", "home.restore"] as const) {
        const present = testCtx({ secrets: { ...fakeSecrets, ageKeySeam: keySeam("present") } }).ctx;
        expect(await byId(id).satisfied!(present)).toBe(false);
        present.p.mkdirp("/fake-home/.mattstack/user/.git");
        expect(await byId(id).satisfied!(present)).toBe(true);

        const absent = testCtx({ secrets: { ...fakeSecrets, ageKeySeam: keySeam("absent") } }).ctx;
        absent.p.mkdirp("/fake-home/.mattstack/user/.git");
        expect(await byId(id).satisfied!(absent)).toBe(false);

        const locked = testCtx({ secrets: { ...fakeSecrets, ageKeySeam: keySeam("locked") } }).ctx;
        locked.p.mkdirp("/fake-home/.mattstack/user/.git");
        expect(await byId(id).satisfied!(locked)).toBe(false);
      }
    });

    test("the team steps are satisfied only by a finished clone: the team settings file and an origin", async () => {
      const { ctx } = testCtx({ team: { slug: "acme", name: "Acme", mode: "join" } });
      const p = ctx.p as ReturnType<typeof fakeProbes>;
      const both = async () => [await byId("team.join").satisfied!(ctx), await byId("team.create").satisfied!(ctx)];

      p.mkdirp("/fake-home/.mattstack/teams/acme");
      p.mkdirp("/fake-home/.mattstack/teams/acme/.git");
      expect(await both()).toEqual([false, false]);
      p.writeFile("/fake-home/.mattstack/teams/acme/mattstack/settings.team.jsonc", "{}");
      expect(await both()).toEqual([false, false]);
      p.writeFile("/fake-home/.mattstack/teams/acme/.git/config", '[remote "upstream"]\n\turl = https://example.com/acme/other.git\n');
      expect(await both()).toEqual([false, false]);
      p.writeFile("/fake-home/.mattstack/teams/acme/.git/config", '[remote "origin"]\n\turl = https://example.com/acme/team.git\n');
      expect(await both()).toEqual([true, true]);
    });

    test("a run with no team yet never reads a team step as satisfied", async () => {
      const { ctx } = testCtx({ team: { slug: "", name: "", mode: "none" } });
      ctx.p.mkdirp("/fake-home/.mattstack/teams/.git");
      expect(await byId("team.create").satisfied!(ctx)).toBe(false);
    });
  });
});

describe("runApplyWith — need-bearing steps", () => {
  type NeedRequestForTest = Parameters<ApplyContext["need"]>[1];

  function needStep(id: StepId, kind: "app" | "privileged", request: NeedRequestForTest): StepDef {
    return {
      id,
      title: id,
      kind,
      applies: () => true,
      async run(c) {
        const reply = await c.need(id, request);
        return outcomeFromNeed(reply);
      },
    };
  }

  test("an 'app' kind step succeeds via ctx.need resolving done, mapped through outcomeFromNeed", async () => {
    const { ctx, events } = testCtx({
      async need(id, request) {
        events.push({ event: "need", id, request });
        return { ok: true, detail: "registered" };
      },
    });

    const result = await runApplyWith([needStep("services.register", "app", { type: "app-register-services", plists: ["com.mattstack.daemon.plist"] })], ctx, {});

    expect(result).toEqual({ ok: true });
    expect(events).toContainEqual({
      event: "need",
      id: "services.register",
      request: { type: "app-register-services", plists: ["com.mattstack.daemon.plist"] },
    });
    expect(events).toContainEqual({ event: "step", id: "services.register", state: "done", detail: "registered" });
  });

  test("a 'privileged' kind step fails via ctx.need resolving failed, mapped through outcomeFromNeed", async () => {
    const { ctx, events } = testCtx({
      async need(id, request) {
        events.push({ event: "need", id, request });
        return { ok: false, detail: "denied" };
      },
    });

    const result = await runApplyWith([needStep("proxy.install", "privileged", { type: "app-privileged", op: "proxy-install" })], ctx, {});

    expect(result).toEqual({ ok: false, failedStep: "proxy.install" });
    expect(events).toContainEqual({ event: "need", id: "proxy.install", request: { type: "app-privileged", op: "proxy-install" } });
    expect(events.at(-2)).toEqual({ event: "step", id: "proxy.install", state: "failed", detail: "denied" });
  });

  test("outcomeFromNeed never maps timeout or app-gone to a non-failure", () => {
    expect(outcomeFromNeed("timeout")).toEqual({ state: "failed", detail: "mattstack.app did not answer in time" });
    expect(outcomeFromNeed("app-gone")).toEqual({ state: "failed", detail: "mattstack.app stopped answering" });
    expect(outcomeFromNeed("no-app").state).toBe("skipped");
    expect(outcomeFromNeed("app-unanswerable")).toEqual({
      state: "failed",
      detail: "mattstack.app is running but cannot answer setup requests from this terminal. Quit it and Retry, or finish setup in the app",
    });
    expect(outcomeFromNeed({ ok: true, detail: "d" })).toEqual({ state: "done", detail: "d" });
    expect(outcomeFromNeed({ ok: false, detail: "d" })).toEqual({ state: "failed", detail: "d" });
  });
});

describe("STEPS registry", () => {
  test("has exactly one def per STEP_IDS entry, in contract order", () => {
    expect(STEPS.map((s) => s.id)).toEqual([...STEP_IDS]);
  });

  // Every step body is real now — steps-a/b/c.test.ts cover home.init
  // through cron.triage and plugins.install through verify respectively.

  test("services.register is kind app, proxy.install is kind privileged, everything else is kind rt", () => {
    for (const step of STEPS) {
      if (step.id === "services.register") expect(step.kind).toBe("app");
      else if (step.id === "proxy.install") expect(step.kind).toBe("privileged");
      else expect(step.kind).toBe("rt");
    }
  });
});

describe("wire bytes", () => {
  test("every line is single-object NDJSON; hostile detail/log content round-trips byte-identical", async () => {
    const lines: string[] = [];
    const hostile = "line1\nline2\r\nx\0y\uD800z\tw";
    const { ctx } = testCtx({ emit: (ev) => lines.push(JSON.stringify(ev) + "\n") });
    const step: StepDef = {
      id: "home.init",
      title: "x",
      kind: "rt",
      applies: () => true,
      async run(c) {
        c.log("home.init", hostile);
        return { state: "done", detail: hostile };
      },
    };

    await runApplyWith([step], ctx, {});

    expect(lines.length).toBeGreaterThan(0);
    for (const raw of lines) {
      expect(raw.endsWith("\n")).toBe(true);
      const body = raw.slice(0, -1);
      expect(body.includes("\n")).toBe(false); // no interior newline outside the trailing terminator
      expect(() => JSON.parse(body)).not.toThrow();
    }

    const parsed = lines.map((l) => JSON.parse(l.slice(0, -1)) as ApplyEvent);
    const logEvent = parsed.find((e) => e.event === "log");
    const doneStep = parsed.find((e) => e.event === "step" && e.state === "done");
    expect(logEvent && (logEvent as { line: string }).line).toBe(hostile);
    expect(doneStep && (doneStep as { detail?: string }).detail).toBe(hostile);
  });
});

describe("createApplyContext", () => {
  test("builds a context with no team when no intent and no cloned teams", async () => {
    const p = fakeProbes();
    const events: ApplyEvent[] = [];
    const ctx = await createApplyContext({
      probes: p,
      emit: (ev) => events.push(ev),
      secrets: fakeSecrets,
      relay: fakeRelay,
      flags: { nonInteractive: false, teamOfOne: false, ci: false },
    });

    expect(ctx.intent).toBeNull();
    expect(ctx.team).toEqual({ slug: "", name: "", mode: "none" });
    expect(ctx.snapshot).toBeNull();
    expect(ctx.reqs).toEqual([]);
    expect(ctx.appPath).toBeNull();
    expect(ctx.nonInteractive).toBe(false);
    expect(ctx.ci).toBe(false);
  });

  test("resolves the team from Probes.home, never from process.env.HOME", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/totally-different-env-home"; // must never be consulted
    try {
      const p = fakeProbes({
        home: "/fake-home",
        files: { "/fake-home/.mattstack/teams/acme/mattstack/settings.team.jsonc": "{}" },
        dirs: { "/fake-home/.mattstack/teams": ["acme"] },
      });
      const ctx = await createApplyContext({
        probes: p,
        emit: () => {},
        secrets: fakeSecrets,
        relay: fakeRelay,
        flags: { nonInteractive: false, teamOfOne: false, ci: false },
      });

      expect(ctx.team.slug).toBe("acme");
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("ctx.log emits a log event under the given step id", async () => {
    const p = fakeProbes();
    const events: ApplyEvent[] = [];
    const ctx = await createApplyContext({
      probes: p,
      emit: (ev) => events.push(ev),
      secrets: fakeSecrets,
      relay: fakeRelay,
      flags: { nonInteractive: false, teamOfOne: false, ci: false },
    });

    ctx.log("home.init", "gh repo create m4ttheweric/mattstack-home --private");

    expect(events).toEqual([{ event: "log", id: "home.init", line: "gh repo create m4ttheweric/mattstack-home --private" }]);
  });

  test("ctx.need short-circuits to no-app when nonInteractive and the tray socket is unreachable, without stranding a need on the stream", async () => {
    const p = fakeProbes(); // default tray always returns status 0 (unreachable)
    const events: ApplyEvent[] = [];
    const ctx = await createApplyContext({
      probes: p,
      emit: (ev) => events.push(ev),
      secrets: fakeSecrets,
      relay: fakeRelay,
      flags: { nonInteractive: true, teamOfOne: false, ci: false },
    });

    const result = await ctx.need("services.register", { type: "app-register-services", plists: [] });

    expect(result).toBe("no-app");
    expect(events).toEqual([]); // reachability is probed BEFORE emitting `need` — nobody is listening
  });

  test("ctx.need refuses fast when nonInteractive and the tray IS reachable — a standalone run's needs have no reader, so waiting is a guaranteed 10-minute hang", async () => {
    const tray = fakeTray({ "GET /version": () => ({ status: 200, json: { version: "1.0.0" } }) });
    const p = fakeProbes({ tray });
    const events: ApplyEvent[] = [];
    const ctx = await createApplyContext({
      probes: p,
      emit: (ev) => events.push(ev),
      secrets: fakeSecrets,
      relay: fakeRelay,
      flags: { nonInteractive: true, teamOfOne: false, ci: false },
    });

    const result = await ctx.need("services.unregister", { type: "app-unregister-services", plists: [] });

    expect(result).toBe("app-unanswerable");
    expect(events).toEqual([]); // refused before emitting — only an app-driven apply services needs
  });

  test("ctx.need emits the need event and threads the injected clock into awaitNeed's poll loop when the app drives the run", async () => {
    let calls = 0;
    const tray = fakeTray({
      "GET /version": () => ({ status: 200, json: { version: "1.0.0" } }),
      "GET /setup/need/services.register": () => {
        calls += 1;
        return calls < 2 ? { status: 200, json: { state: "pending" } } : { status: 200, json: { state: "done", detail: "registered" } };
      },
    });
    const p = fakeProbes({ tray, env: { RT_APP_SOCKET: "/fake-home/.mattstack/rt/tray.sock" } });
    const events: ApplyEvent[] = [];
    let elapsedMs = 0;
    const ctx = await createApplyContext({
      probes: p,
      emit: (ev) => events.push(ev),
      secrets: fakeSecrets,
      relay: fakeRelay,
      flags: { nonInteractive: false, teamOfOne: false, ci: false },
      needOpts: {
        pollMs: 1_000,
        timeoutMs: 60_000,
        now: () => elapsedMs,
        sleep: async (ms) => {
          elapsedMs += ms;
        },
      },
    });

    const result = await ctx.need("services.register", { type: "app-register-services", plists: ["x"] });

    expect(result).toEqual({ ok: true, detail: "registered" });
    expect(calls).toBe(2);
    expect(events).toContainEqual({ event: "need", id: "services.register", request: { type: "app-register-services", plists: ["x"] } });
  });
});

// The app performs needs only for the rt it spawned (RT_APP_SOCKET set); a
// terminal run used to emit a need nobody read and poll for ten minutes.
describe("createApplyContext: a terminal run asks the app's routes directly", () => {
  const reachable = { "GET /version": () => ({ status: 200, json: { version: "1.0.0" } }) };

  async function terminalCtx(tray: ReturnType<typeof fakeTray>, opts: { nonInteractive?: boolean; tty?: boolean; env?: Record<string, string> } = {}) {
    const events: ApplyEvent[] = [];
    const ctx = await createApplyContext({
      probes: fakeProbes({ tray, env: opts.env ?? {} }),
      emit: (ev) => events.push(ev),
      secrets: fakeSecrets,
      relay: fakeRelay,
      flags: { nonInteractive: opts.nonInteractive ?? false, teamOfOne: false, ci: false, tty: opts.tty ?? true },
      needOpts: { timeoutMs: 0, sleep: async () => {} },
    });
    return { ctx, events };
  }

  test("services.register goes to /services/register and never emits a need", async () => {
    const tray = fakeTray({
      ...reachable,
      "POST /services/register": () => ({ status: 200, json: { ok: true, results: [{ plist: "d.plist", ok: true, status: "enabled" }] } }),
    });
    const { ctx, events } = await terminalCtx(tray);

    expect(await ctx.need("services.register", { type: "app-register-services", plists: ["d.plist"] })).toEqual({ ok: true, detail: "d.plist: enabled" });
    expect(events.some((e) => e.event === "need")).toBe(false);
  });

  test("the proxy install goes to its privileged route", async () => {
    const tray = fakeTray({ ...reachable, "POST /privileged/proxy-install": () => ({ status: 200, json: { ok: true, detail: "installed" } }) });
    const { ctx } = await terminalCtx(tray);

    expect(await ctx.need("proxy.install", { type: "app-privileged", op: "proxy-install" })).toEqual({ ok: true, detail: "installed" });
  });

  test("with no app running it answers no-app at once, which the step turns into open mattstack.app and retry", async () => {
    const noTray: ReturnType<typeof fakeTray> = async () => ({ status: 0, json: null });
    const { ctx, events } = await terminalCtx(noTray);

    expect(await ctx.need("services.register", { type: "app-register-services", plists: ["d.plist"] })).toBe("no-app");
    expect(events).toEqual([]);

    const outcome = await STEPS.find((s) => s.id === "services.register")!.run(ctx);
    expect(outcome).toMatchObject({ state: "failed", remedy: "Open mattstack.app, then Retry" });
  });

  test("a non-interactive terminal run still registers services directly", async () => {
    const tray = fakeTray({
      ...reachable,
      "POST /services/register": () => ({ status: 200, json: { ok: true, results: [{ plist: "d.plist", ok: true, status: "enabled" }] } }),
    });
    const { ctx } = await terminalCtx(tray, { nonInteractive: true });

    expect(await ctx.need("services.register", { type: "app-register-services", plists: ["d.plist"] })).toEqual({ ok: true, detail: "d.plist: enabled" });
  });

  test("a non-interactive terminal run never raises an admin prompt nobody is there to answer", async () => {
    let asked = false;
    const tray = fakeTray({
      ...reachable,
      "POST /privileged/proxy-install": () => {
        asked = true;
        return { status: 200, json: { ok: true, detail: "installed" } };
      },
    });
    const { ctx } = await terminalCtx(tray, { nonInteractive: true });

    expect(await ctx.need("proxy.install", { type: "app-privileged", op: "proxy-install" })).toBe("app-unanswerable");
    expect(asked).toBe(false);
  });

  test("a run with no terminal (an agent's shell) never raises an admin prompt either", async () => {
    let asked = false;
    const tray = fakeTray({
      ...reachable,
      "POST /privileged/proxy-trust": () => {
        asked = true;
        return { status: 200, json: { ok: true, detail: "trusted" } };
      },
      "POST /services/register": () => ({ status: 200, json: { ok: true, results: [] } }),
    });
    const { ctx } = await terminalCtx(tray, { tty: false });

    expect(await ctx.need("proxy.install", { type: "app-privileged", op: "proxy-trust" })).toBe("needs-terminal");
    expect(asked).toBe(false);
    expect(await ctx.need("services.register", { type: "app-register-services", plists: [] })).toEqual({ ok: true, detail: "" });
  });

  // Quitting the app, the remedy for a non-interactive run, would only swap
  // this failure for "open mattstack.app".
  test("the step tells a caller with no terminal where the admin prompt can be answered", async () => {
    const tray = fakeTray({ ...reachable });
    const { ctx } = await terminalCtx(tray, { tty: false });
    const outcome = needOutcome(await ctx.need("proxy.install", { type: "app-privileged", op: "proxy-install" }), ctx, {
      noAppDetail: "x",
      noAppRemedy: "x",
      timeoutRemedy: "x",
    });

    expect(outcome).toEqual({
      state: "failed",
      detail: "This step raises an admin prompt, which needs a person at a terminal",
      remedy: "Run rt setup apply from a terminal, or use the row's button in mattstack.app",
    });
  });

  test("a run the app spawned keeps the need protocol, since the app pumps it", async () => {
    let direct = false;
    const tray = fakeTray({
      ...reachable,
      "POST /services/register": () => {
        direct = true;
        return { status: 200, json: { ok: true, results: [] } };
      },
      "GET /setup/need/services.register": () => ({ status: 200, json: { state: "done", detail: "pumped" } }),
    });
    const { ctx, events } = await terminalCtx(tray, { env: { RT_APP_SOCKET: "/fake-home/.mattstack/rt/tray.sock" } });

    expect(await ctx.need("services.register", { type: "app-register-services", plists: ["d.plist"] })).toEqual({ ok: true, detail: "pumped" });
    expect(direct).toBe(false);
    expect(events.some((e) => e.event === "need")).toBe(true);
  });
});

describe("ApplyContext.redact", () => {
  test("a registered exact value never appears in log lines or step details", async () => {
    const p = fakeProbes();
    const events: ApplyEvent[] = [];
    const ctx = await createApplyContext({
      probes: p,
      emit: (ev) => events.push(ev),
      secrets: fakeSecrets,
      relay: fakeRelay,
      flags: { nonInteractive: false, teamOfOne: false, ci: false },
    });
    const secret = "sekrit-invite-key-value";
    ctx.redact(secret);

    const step: StepDef = {
      id: "team.join",
      title: "Join your team",
      kind: "rt",
      applies: () => true,
      async run(c) {
        c.log("team.join", `posting with key=${secret}`);
        return { state: "done", detail: `used key ${secret}` };
      },
    };

    await runApplyWith([step], ctx, {});

    const serialized = JSON.stringify(events);
    expect(serialized.includes(secret)).toBe(false);
    expect(events).toContainEqual({ event: "log", id: "team.join", line: "posting with key=***" });
    expect(events).toContainEqual({ event: "step", id: "team.join", state: "done", detail: "used key ***" });
  });

  test("createApplyContext seeds the registry with intent.join.keyB64", async () => {
    const rawKey = "raw-invite-key-material";
    const p = fakeProbes({
      files: {
        "/fake-home/.mattstack/rt/setup-intent.json": JSON.stringify({
          v: 1,
          at: "x",
          mode: "join",
          join: {
            id: "invite-id",
            keyB64: rawKey,
            pointer: { v: 1, team: "acme", name: "Acme", remote: "r", owner: "o", forge: "github.com", createdAt: "x" },
          },
        }),
      },
    });
    const events: ApplyEvent[] = [];
    const ctx = await createApplyContext({
      probes: p,
      emit: (ev) => events.push(ev),
      secrets: fakeSecrets,
      relay: fakeRelay,
      flags: { nonInteractive: false, teamOfOne: false, ci: false },
    });

    ctx.log("team.join", `key=${rawKey}`);

    expect(events).toEqual([{ event: "log", id: "team.join", line: "key=***" }]);
  });
});

function fakeMigration(id: string, outcome: StepOutcome | (() => Promise<StepOutcome>)): MigrationDef {
  return { id, title: id, run: typeof outcome === "function" ? outcome : async () => outcome };
}

function updateStep(id: StepId, outcome: StepOutcome, updateSafe: true | undefined = true): StepDef {
  return { ...fakeStep(id, outcome), ...(updateSafe ? { updateSafe: true } : {}) };
}

// An update stamps lastApplyAt like any run, but it is not a full apply.
describe("runUpdateWith and the finished state", () => {
  const STATE = "/fake-home/.mattstack/rt/setup-state.json";

  test("an update run never sets lastApplyOk, so it cannot reopen a failed setup at Done", async () => {
    const { ctx } = testCtx();
    await runApplyWith([fakeStep("path.link", { state: "failed", detail: "boom" })], ctx);
    await runUpdateWith([updateStep("path.link", { state: "done" })], [], ctx);
    expect(readSetupState(ctx.p as ReturnType<typeof fakeProbes>).lastApplyOk).toBe(false);

    const fresh = testCtx().ctx;
    await runUpdateWith([updateStep("path.link", { state: "done" })], [], fresh);
    expect(readSetupState(fresh.p as ReturnType<typeof fakeProbes>).lastApplyOk).toBeUndefined();
  });

  test("on a v1 Mac the legacy finish is settled before the update's first migration runs", async () => {
    const { ctx } = testCtx();
    const p = ctx.p as ReturnType<typeof fakeProbes>;
    p.writeFile("/fake-home/.mattstack/rt/daemon.json", "{}");
    p.writeFile(STATE, JSON.stringify({ v: 1, marketplaces: [], plugins: [], links: ["gh"], extensionEditors: [], forcedLinks: [] }));
    let seen: { v?: number; finishedAt?: string } = {};
    const migration = fakeMigration("2026-10-01-setup-intent", async () => {
      seen = JSON.parse(p.readFile(STATE)!);
      p.writeFile("/fake-home/.mattstack/rt/setup-intent.json", "{}");
      return { state: "done" };
    });

    await runUpdateWith([], [migration], ctx);

    expect(seen.v).toBe(2);
    expect(typeof seen.finishedAt).toBe("string");
    expect(isSetupFinished(readSetupState(p))).toBe(true);
  });

  test("a run stamping lastApplyAt over a v1 file with a team choice pending does not prove finished", async () => {
    const { ctx } = testCtx();
    const p = ctx.p as ReturnType<typeof fakeProbes>;
    p.writeFile("/fake-home/.mattstack/rt/setup-intent.json", "{}");
    p.writeFile(STATE, JSON.stringify({ v: 1, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [] }));

    await runUpdateWith([updateStep("path.link", { state: "done" })], [], ctx);
    expect(isSetupFinished(readSetupState(p))).toBe(false);
    await runApplyWith([fakeStep("path.link", { state: "done" })], ctx, { only: "path.link" });
    expect(isSetupFinished(readSetupState(p))).toBe(false);
  });
});

describe("runUpdateWith", () => {
  test("runs pending migrations, then update-safe steps in order, then verify; non-safe steps never run", async () => {
    const { ctx, events } = testCtx();
    const ran: string[] = [];
    const steps: StepDef[] = [
      updateStep("verify", { state: "done", detail: "3 checks passed" }),
      { ...fakeStep("repos.clone", async () => { ran.push("repos.clone"); return { state: "done" }; }) },
      updateStep("path.link", { state: "done", detail: "linked: rt" }),
      updateStep("claude.permissions", { state: "skipped", detail: "already present" }),
    ];
    const migrations = [fakeMigration("2026-09-30-move-file", async () => { ran.push("m1"); return { state: "done", detail: "moved" }; })];

    const result = await runUpdateWith(steps, migrations, ctx);

    expect(result.ok).toBe(true);
    expect(ran).toEqual(["m1"]);
    const stepEvents = events.filter((e) => e.event === "step" && e.state !== "running").map((e) => (e.event === "step" ? e.id : ""));
    expect(stepEvents).toEqual(["migration.2026-09-30-move-file", "path.link", "claude.permissions", "verify"]);
    const plan = events.find((e) => e.event === "plan");
    expect(plan && plan.event === "plan" ? plan.steps.map((s) => s.id) : []).toEqual(["migration.2026-09-30-move-file", "path.link", "claude.permissions", "verify"]);
    expect(result.outcomes).toEqual([
      { id: "migration.2026-09-30-move-file", state: "done", detail: "moved" },
      { id: "path.link", state: "done", detail: "linked: rt" },
      { id: "claude.permissions", state: "skipped", detail: "already present" },
      { id: "verify", state: "done", detail: "3 checks passed" },
    ]);
  });

  test("records done and skipped migrations in setup-state, never a failed one, and skips already-recorded ids", async () => {
    const { ctx } = testCtx();
    ctx.p.mkdirp("/fake-home/.mattstack/rt");
    ctx.p.writeFile("/fake-home/.mattstack/rt/setup-state.json", JSON.stringify({ v: 1, migrations: ["old"] }));
    const ran: string[] = [];
    const migrations = [
      fakeMigration("old", async () => { ran.push("old"); return { state: "done" }; }),
      fakeMigration("a", { state: "done" }),
      fakeMigration("b", { state: "skipped", detail: "nothing to fix" }),
      fakeMigration("c", { state: "failed", detail: "boom" }),
    ];

    const result = await runUpdateWith([], migrations, ctx);

    expect(ran).toEqual([]);
    expect(readSetupState(ctx.p).migrations).toEqual(["old", "a", "b"]);
    expect(result.ok).toBe(false);
    expect(result.failedSteps).toEqual(["migration.c"]);
  });

  test("a failure never stops the run; done carries failedStep (first) and failedSteps (all)", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [
      updateStep("path.link", { state: "failed", detail: "no bin dir" }),
      updateStep("skills.link", { state: "done" }),
      updateStep("claude.permissions", { state: "failed", detail: "not json" }),
      updateStep("verify", { state: "needs-you", detail: "to connect: Slack" }),
    ];

    const result = await runUpdateWith(steps, [], ctx);

    expect(events.filter((e) => e.event === "step" && e.state === "done").length).toBe(1);
    const done = events.at(-1);
    expect(done).toEqual({ event: "done", ok: false, failedStep: "path.link", failedSteps: ["path.link", "claude.permissions"] });
    expect(result.failedSteps).toEqual(["path.link", "claude.permissions"]);
  });

  test("a migration throwing a plain Error fails alone: logged, recorded nowhere, and every later item still runs", async () => {
    const { ctx, events } = testCtx();
    const migrations = [fakeMigration("bad", async () => { throw new Error("kaboom"); }), fakeMigration("after", { state: "done" })];
    const steps: StepDef[] = [updateStep("path.link", { state: "done" }), updateStep("verify", { state: "done" })];

    const result = await runUpdateWith(steps, migrations, ctx);

    expect(events.filter((e) => e.event === "done").length).toBe(1);
    expect(events.filter((e) => e.event === "step" && e.id === "migration.bad" && e.state === "failed")).toEqual([
      { event: "step", id: "migration.bad", state: "failed", detail: "bug: kaboom" },
    ]);
    expect(events).toContainEqual({ event: "log", id: "migration.bad", line: "warn: bug: kaboom" });
    expect(readSetupState(ctx.p).migrations).toEqual(["after"]);
    expect(result.outcomes.map((o) => `${o.id}:${o.state}`)).toEqual(["migration.bad:failed", "migration.after:done", "path.link:done", "verify:done"]);
    expect(result.failedSteps).toEqual(["migration.bad"]);
    expect(events.at(-1)).toEqual({ event: "done", ok: false, failedStep: "migration.bad", failedSteps: ["migration.bad"] });
  });

  test("a step throwing a plain Error is a bug: reported failed, later items skipped, rethrown after exactly one done", async () => {
    const { ctx, events } = testCtx();
    const ran: string[] = [];
    const steps: StepDef[] = [
      { ...updateStep("path.link", { state: "done" }), run: async () => { throw new Error("kaboom"); } },
      { ...updateStep("verify", { state: "done" }), run: async () => { ran.push("verify"); return { state: "done" }; } },
    ];

    await expect(runUpdateWith(steps, [], ctx)).rejects.toThrow("kaboom");

    expect(ran).toEqual([]);
    expect(events.filter((e) => e.event === "done")).toEqual([{ event: "done", ok: false, failedStep: "path.link", failedSteps: ["path.link"] }]);
    expect(events).toContainEqual({ event: "step", id: "path.link", state: "failed", detail: "bug: kaboom" });
  });

  test("a step throwing UserActionableError becomes a failed item with its remedy and the run goes on", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [
      updateStep("path.link", { state: "done" }),
      { ...updateStep("skills.link", { state: "done" }), run: async () => { throw new UserActionableError("x", "cannot link", { remedy: "relink by hand" }); } },
      updateStep("verify", { state: "done" }),
    ];
    const result = await runUpdateWith(steps, [], ctx);
    expect(result.ok).toBe(false);
    expect(events.find((e) => e.event === "step" && e.id === "skills.link" && e.state === "failed")).toMatchObject({ detail: "cannot link", remedy: "relink by hand" });
    expect(events.find((e) => e.event === "step" && e.id === "verify" && e.state === "done")).toBeDefined();
  });

  test("writes lastApplyAt and keeps the setup intent", async () => {
    const { ctx } = testCtx();
    ctx.p.mkdirp("/fake-home/.mattstack/rt");
    ctx.p.writeFile("/fake-home/.mattstack/rt/setup-intent.json", JSON.stringify({ mode: "restore", homeRepo: "o/r" }));
    await runUpdateWith([updateStep("verify", { state: "done" })], [], ctx);
    expect(readSetupState(ctx.p).lastApplyAt).toBeDefined();
    expect(ctx.p.readFile("/fake-home/.mattstack/rt/setup-intent.json")).not.toBeNull();
  });

  test("verify runs last even when listed first in the registry, and a steps list without verify still runs", async () => {
    const { ctx, events } = testCtx();
    const steps: StepDef[] = [updateStep("verify", { state: "done" }), updateStep("path.link", { state: "done" })];
    await runUpdateWith(steps, [], ctx);
    const ids = events.filter((e) => e.event === "step" && e.state !== "running").map((e) => (e.event === "step" ? e.id : ""));
    expect(ids).toEqual(["path.link", "verify"]);
    const { ctx: ctx2, events: events2 } = testCtx();
    await runUpdateWith([updateStep("path.link", { state: "done" })], [], ctx2);
    expect(events2.at(-1)).toEqual({ event: "done", ok: true });
  });
});

test("a settings tip raised inside a step reaches ctx.tip, not the log event", async () => {
  const tips: Array<[string, string]> = [];
  const { ctx, events } = testCtx({ tip: (id, line) => tips.push([id, line]) });
  const step: StepDef = {
    id: "path.link",
    title: "x",
    kind: "rt",
    applies: () => true,
    async run() {
      const engine = setSettingsNoticeSink(null);
      (engine as unknown as (line: string) => void)("Saved on this Mac only.");
      setSettingsNoticeSink(engine);
      return { state: "done" };
    },
  };
  await runApplyWith([step], ctx, {});
  expect(tips).toEqual([["path.link", "Saved on this Mac only."]]);
  expect(events.some((e) => e.event === "log")).toBe(false);
});
