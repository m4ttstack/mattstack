import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath } from "../../rt-paths.ts";
import { setSetting } from "../../settings/write.ts";
import { CRON_RELOAD_AFTER_MS, parseCronConfig, loadCronConfig, startCron, type CronTrigger } from "../cron.ts";

const log = { info: () => {}, warn: () => {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("parseCronConfig", () => {
  test("parses a resolved object and validates triggers", () => {
    const cfg = parseCronConfig({
      triggers: [{ name: "t", event: "project-mrs", repoName: "acme-dev", run: ["echo", "hi"] }],
    });
    expect(cfg.triggers).toHaveLength(1);
    expect(cfg.triggers[0]!.debounceMs).toBeUndefined();
  });

  test("rejects triggers missing name/event/run", () => {
    expect(() => parseCronConfig({ triggers: [{ event: "x", run: ["a"] }] })).toThrow();
    expect(() => parseCronConfig({ triggers: [{ name: "t", event: "x", run: [] }] })).toThrow();
  });

  test("rejects two triggers with the same name", () => {
    expect(() =>
      parseCronConfig({
        triggers: [
          { name: "t", event: "a", run: ["one"] },
          { name: "t", event: "b", run: ["two"] },
        ],
      }),
    ).toThrow('rt.cron has two triggers named "t"');
  });

  test("carries an optional tool through", () => {
    const cfg = parseCronConfig({ triggers: [{ name: "t", event: "x", tool: "board", run: ["triage"] }] });
    expect(cfg.triggers[0]).toEqual({ name: "t", event: "x", tool: "board", run: ["triage"], repoName: undefined, debounceMs: undefined });
  });

  test("rejects an empty or non-string tool", () => {
    expect(() => parseCronConfig({ triggers: [{ name: "t", event: "x", tool: "", run: ["a"] }] })).toThrow('"tool" must be a non-empty string');
    expect(() => parseCronConfig({ triggers: [{ name: "t", event: "x", tool: 1, run: ["a"] }] })).toThrow('"tool" must be a non-empty string');
  });

  test("undefined/empty input degrades to no triggers", () => {
    expect(parseCronConfig(undefined)).toEqual({ triggers: [] });
    expect(parseCronConfig({})).toEqual({ triggers: [] });
  });
});

describe("loadCronConfig through the settings resolver", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-cron-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("empty store degrades to no triggers", () => {
    expect(loadCronConfig()).toEqual({ triggers: [] });
  });

  test("a store-seeded value resolves through the loader", () => {
    setSetting(
      "rt.cron",
      { triggers: [{ name: "t", event: "project-mrs", run: ["echo", "hi"] }] },
      "machine",
    );

    const cfg = loadCronConfig();
    expect(cfg.triggers).toHaveLength(1);
    expect(cfg.triggers[0]!.name).toBe("t");
  });

  test("an invalid stored value degrades to no triggers and warns", () => {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.cron": { triggers: [{ name: "t" }] } }));

    const warnings: string[] = [];
    const cfg = loadCronConfig({ info: () => {}, warn: (m) => warnings.push(m) });
    expect(cfg.triggers).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("an unexpandable ${repoRoot} in a trigger's run string degrades to no triggers instead of throwing", () => {
    setSetting(
      "rt.cron",
      { triggers: [{ name: "t", event: "e", run: ["${repoRoot}/script.sh"] }] },
      "machine",
    );

    const warnings: string[] = [];
    expect(() => loadCronConfig({ info: () => {}, warn: (m) => warnings.push(m) })).not.toThrow();
    expect(loadCronConfig()).toEqual({ triggers: [] });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("startCron with the settings loader", () => {
  const origHome = process.env.HOME;
  let home: string;
  let clock: number;
  const now = () => clock;
  const peer = (run: string[] = ["peer"], debounceMs = 5): CronTrigger => ({ name: "board-peer", event: "peer-inbox", run, debounceMs });
  const store = (triggers: CronTrigger[]) => setSetting("rt.cron", { triggers }, "machine");

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-cron-live-")));
    process.env.HOME = home;
    clock = 1_000_000;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("a trigger written after start fires once the reload window has passed", async () => {
    const runs: string[][] = [];
    const cron = startCron(loadCronConfig, { log, now, runCommand: (argv) => runs.push(argv) });
    store([peer()]);

    clock += CRON_RELOAD_AFTER_MS - 1;
    cron.onBroadcast("peer-inbox", null);
    await sleep(20);
    expect(runs).toEqual([]);

    clock += 1;
    cron.onBroadcast("peer-inbox", null);
    await sleep(20);
    expect(runs).toEqual([["peer"]]);
    cron.dispose();
  });

  test("a removed trigger stops firing and its pending run is dropped", async () => {
    store([peer(["peer"], 30)]);
    const runs: string[][] = [];
    const cron = startCron(loadCronConfig, { log, now, runCommand: (argv) => runs.push(argv) });

    cron.onBroadcast("peer-inbox", null);
    store([]);
    clock += CRON_RELOAD_AFTER_MS;
    cron.onBroadcast("project-mrs", null);
    await sleep(60);
    expect(runs).toEqual([]);

    cron.onBroadcast("peer-inbox", null);
    await sleep(60);
    expect(runs).toEqual([]);
    cron.dispose();
  });

  test("a reload clears a removed trigger's timer, so re-adding the name does not revive the run", async () => {
    store([peer(["old"], 60)]);
    const runs: string[][] = [];
    const cron = startCron(loadCronConfig, { log, now, runCommand: (argv) => runs.push(argv) });

    cron.onBroadcast("peer-inbox", null);
    store([]);
    clock += CRON_RELOAD_AFTER_MS;
    cron.onBroadcast("project-mrs", null);
    store([peer(["back"], 60)]);
    clock += CRON_RELOAD_AFTER_MS;
    cron.onBroadcast("project-mrs", null);
    await sleep(120);
    expect(runs).toEqual([]);
    cron.dispose();
  });

  test("a pending run survives a reload and runs the trigger as reloaded", async () => {
    store([peer(["old"], 30)]);
    const runs: string[][] = [];
    const cron = startCron(loadCronConfig, { log, now, runCommand: (argv) => runs.push(argv) });

    cron.onBroadcast("peer-inbox", null);
    store([peer(["new"], 30)]);
    clock += CRON_RELOAD_AFTER_MS;
    cron.onBroadcast("project-mrs", null);
    await sleep(60);
    expect(runs).toEqual([["new"]]);
    cron.dispose();
  });

  test("the armed line logs only when the armed set changes", () => {
    store([peer()]);
    const infos: string[] = [];
    const cron = startCron(loadCronConfig, { log: { info: (m) => infos.push(m), warn: () => {} }, now, runCommand: () => {} });
    for (let i = 0; i < 3; i++) {
      clock += CRON_RELOAD_AFTER_MS;
      cron.onBroadcast("project-mrs", null);
    }
    expect(infos.filter((m) => m.includes("armed"))).toEqual(["cron: 1 trigger(s) armed"]);

    store([peer(), { name: "board-triage", event: "project-mrs", run: ["triage"] }]);
    clock += CRON_RELOAD_AFTER_MS;
    cron.onBroadcast("project-mrs", null);
    expect(infos.filter((m) => m.includes("armed"))).toEqual(["cron: 1 trigger(s) armed", "cron: 2 trigger(s) armed"]);
    cron.dispose();
  });

  test("an invalid setting warns once per distinct message across reloads", () => {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.cron": { triggers: [{ name: "t" }] } }));
    const warnings: string[] = [];
    const cron = startCron(loadCronConfig, { log: { info: () => {}, warn: (m) => warnings.push(m) }, now, runCommand: () => {} });
    for (let i = 0; i < 3; i++) {
      clock += CRON_RELOAD_AFTER_MS;
      cron.onBroadcast("project-mrs", null);
    }
    expect(warnings).toHaveLength(1);

    writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.cron": { triggers: [{ name: "t", event: "e" }] } }));
    clock += CRON_RELOAD_AFTER_MS;
    cron.onBroadcast("project-mrs", null);
    expect(warnings).toHaveLength(2);
    cron.dispose();
  });
});

describe("startCron", () => {
  test("matching events run the command once per debounce window", async () => {
    const runs: string[][] = [];
    const cron = startCron(
      { triggers: [{ name: "t", event: "project-mrs", repoName: "acme-dev", run: ["echo", "hi"], debounceMs: 20 }] },
      { log, runCommand: (argv) => runs.push(argv) },
    );
    cron.onBroadcast("project-mrs", { repoName: "acme-dev" });
    cron.onBroadcast("project-mrs", { repoName: "acme-dev" }); // burst: coalesced
    cron.onBroadcast("project-mrs", { repoName: "other-repo" });  // wrong repo: ignored
    cron.onBroadcast("discussions:update", { repoName: "acme-dev" }); // wrong event: ignored
    expect(runs).toHaveLength(0); // trailing edge: nothing yet
    await sleep(40);
    expect(runs).toEqual([["echo", "hi"]]);
    cron.dispose();
  });

  test("a trigger without repoName matches any payload", async () => {
    const runs: string[][] = [];
    const cron = startCron(
      { triggers: [{ name: "t", event: "tick", run: ["x"], debounceMs: 5 }] },
      { log, runCommand: (argv) => runs.push(argv) },
    );
    cron.onBroadcast("tick", null);
    await sleep(20);
    expect(runs).toHaveLength(1);
    cron.dispose();
  });

  test("a tool trigger runs the tool the running app resolves, with run as its arguments", async () => {
    const runs: string[][] = [];
    const asked: string[] = [];
    const cron = startCron(
      { triggers: [{ name: "t", event: "tick", tool: "board", run: ["triage", "--peer"], debounceMs: 5 }] },
      {
        log,
        runCommand: (argv) => runs.push(argv),
        resolveTool: (tool) => {
          asked.push(tool);
          return ["/Applications/mattstack.app/Contents/Helpers/board"];
        },
      },
    );
    cron.onBroadcast("tick", null);
    await sleep(20);
    expect(asked).toEqual(["board"]);
    expect(runs).toEqual([["/Applications/mattstack.app/Contents/Helpers/board", "triage", "--peer"]]);
    cron.dispose();
  });

  test("a tool the running app cannot find warns and skips the run", async () => {
    const runs: string[][] = [];
    const warnings: string[] = [];
    const cron = startCron(
      { triggers: [{ name: "t", event: "tick", tool: "board", run: ["triage"], debounceMs: 5 }] },
      { log: { info: () => {}, warn: (m) => warnings.push(m) }, runCommand: (argv) => runs.push(argv), resolveTool: () => null },
    );
    cron.onBroadcast("tick", null);
    await sleep(20);
    expect(runs).toEqual([]);
    expect(warnings).toEqual(['cron t: tool "board" was not found in the running app, so this run was skipped']);
    cron.dispose();
  });

  test("a tool lookup that throws warns and skips instead of throwing from the timer", async () => {
    const runs: string[][] = [];
    const warnings: string[] = [];
    const cron = startCron(
      { triggers: [{ name: "t", event: "tick", tool: "board", run: ["triage"], debounceMs: 5 }] },
      {
        log: { info: () => {}, warn: (m) => warnings.push(m) },
        runCommand: (argv) => runs.push(argv),
        resolveTool: () => {
          throw new Error("boom");
        },
      },
    );
    cron.onBroadcast("tick", null);
    await sleep(20);
    expect(runs).toEqual([]);
    expect(warnings).toEqual(['cron t: could not look up tool "board", so this run was skipped: boom']);
    cron.dispose();
  });

  test("a trigger without a tool never asks for one", async () => {
    const runs: string[][] = [];
    const cron = startCron(
      { triggers: [{ name: "t", event: "tick", run: ["x", "y"], debounceMs: 5 }] },
      {
        log,
        runCommand: (argv) => runs.push(argv),
        resolveTool: () => {
          throw new Error("asked for a tool");
        },
      },
    );
    cron.onBroadcast("tick", null);
    await sleep(20);
    expect(runs).toEqual([["x", "y"]]);
    cron.dispose();
  });

  test("dispose cancels pending runs", async () => {
    const runs: string[][] = [];
    const cron = startCron(
      { triggers: [{ name: "t", event: "tick", run: ["x"], debounceMs: 20 }] },
      { log, runCommand: (argv) => runs.push(argv) },
    );
    cron.onBroadcast("tick", null);
    cron.dispose();
    await sleep(40);
    expect(runs).toHaveLength(0);
  });

  // The real (non-overridden) spawn path: Bun.spawn without an explicit
  // `env` key gives the child the env snapshot from when THIS bun process
  // started, not process.env as mutated at runtime (verified directly:
  // omitting `env` leaves a child reading a var reassigned post-startup at
  // its ORIGINAL value; `env: { ...process.env }` gives it the live one).
  // That is exactly what the daemon's boot-time PATH overlay does to
  // process.env.PATH, so this exercises the same shape with a plain var —
  // an absolute argv[0] sidesteps unrelated PATH-search mechanics.
  test("cron spawns with the live process.env, not the frozen start snapshot", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-cron-env-")));
    const marker = join(dir, "ran.txt");
    const script = join(dir, "marker.sh");
    writeFileSync(script, `#!/bin/sh\necho "$CRON_TEST_VALUE" > "${marker}"\n`, { mode: 0o755 });

    const varName = "CRON_TEST_VALUE";
    delete process.env[varName]; // absent at this bun process's own startup
    process.env[varName] = "live-value"; // set only after startup, like resolveUserPath does to PATH
    try {
      const cron = startCron(
        { triggers: [{ name: "t", event: "tick", run: [script], debounceMs: 5 }] },
        { log },
      );
      cron.onBroadcast("tick", null);
      await sleep(500); // real process spawn + exit, not a mocked runCommand
      cron.dispose();
      expect(readFileSync(marker, "utf8").trim()).toBe("live-value");
    } finally {
      delete process.env[varName];
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a failed cron command", () => {
  const runOnce = async (script: string) => {
    const warns: string[] = [];
    const cron = startCron(
      { triggers: [{ name: "t", event: "tick", run: ["sh", "-c", script], debounceMs: 5 }] },
      { log: { info: () => {}, warn: (m) => warns.push(m) } },
    );
    cron.onBroadcast("tick", null);
    await sleep(500);
    cron.dispose();
    return warns;
  };

  test("logs the tail of its stderr with the exit code", async () => {
    expect(await runOnce("echo first >&2; echo db schema too new >&2; exit 3")).toEqual([
      "cron t: exited 3: first\ndb schema too new",
    ]);
  });

  test("a clean exit logs no stderr", async () => {
    expect(await runOnce("echo chatter >&2")).toEqual([]);
  });
});
