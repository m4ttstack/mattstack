import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { superpowersForkSwapMigration } from "../migrations/superpowers-fork-swap.ts";
import type { ExecResult } from "../probes.ts";
import { readSetupState } from "../state.ts";
import { fakeProbes, ok } from "./fakes.ts";

type Listed = { id: string; enabled: boolean; scope?: string };
type Call = { argv: string[]; dir: string | undefined };

describe("2026-11-18-superpowers-fork-swap", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-sp-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const defaultDir = () => join(home, ".claude");
  const sessionDir = (s: string) => join(home, ".claude-swap-backup", "sessions", s);

  function harness(opts: { lists: Record<string, Listed[] | ExecResult>; sessions?: string[]; claude?: boolean; failDisable?: (dir: string | undefined) => boolean }) {
    const calls: Call[] = [];
    const files: Record<string, string> = opts.claude === false ? {} : { "/usr/local/bin/claude": "bin" };
    const dirs: Record<string, string[]> = {};
    const statPaths: Record<string, { isDirectory: boolean; writable: boolean }> = {};
    if (opts.sessions) {
      dirs[join(home, ".claude-swap-backup", "sessions")] = opts.sessions;
      for (const s of opts.sessions) statPaths[sessionDir(s)] = { isDirectory: true, writable: true };
    }
    const p = fakeProbes({
      home,
      env: { PATH: "/usr/local/bin" },
      files,
      dirs,
      statPaths,
      exec: async (argv, execOpts) => {
        const dir = execOpts?.env?.CLAUDE_CONFIG_DIR;
        calls.push({ argv: argv.slice(1), dir });
        if (argv[1] === "plugin" && argv[2] === "list") {
          const listed = opts.lists[dir ?? defaultDir()] ?? [];
          return Array.isArray(listed) ? ok(JSON.stringify(listed)) : listed;
        }
        if (argv[1] === "plugin" && argv[2] === "disable" && opts.failDisable?.(dir)) return { code: 1, stdout: "", stderr: "boom" };
        return ok("");
      },
    });
    const ctx = { p } as Partial<ApplyContext> as ApplyContext;
    const disables = () => calls.filter((c) => c.argv[1] === "disable");
    return { p, ctx, calls, disables };
  }

  test("is registered with its dated id", () => {
    expect(MIGRATIONS.map((m) => m.id)).toContain("2026-11-18-superpowers-fork-swap");
    expect(superpowersForkSwapMigration.title).toBe("Switch to mattstack's superpowers");
  });

  test("an enabled stock copy is disabled at user scope and recorded", async () => {
    const h = harness({ lists: { [defaultDir()]: [{ id: "superpowers@claude-plugins-official", enabled: true, scope: "user" }, { id: "superpowers@mattstack", enabled: true, scope: "user" }] } });
    const outcome = await superpowersForkSwapMigration.run(h.ctx);
    expect(outcome.state).toBe("done");
    expect(h.disables()).toEqual([{ argv: ["plugin", "disable", "superpowers@claude-plugins-official"], dir: defaultDir() }]);
    expect(readSetupState(h.p).superpowersDisabled).toEqual([{ configDir: defaultDir(), id: "superpowers@claude-plugins-official" }]);
  });

  test("a stock copy the member already turned off is left alone and nothing is recorded", async () => {
    const h = harness({ lists: { [defaultDir()]: [{ id: "superpowers@claude-plugins-official", enabled: false, scope: "user" }] } });
    const outcome = await superpowersForkSwapMigration.run(h.ctx);
    expect(outcome.state).toBe("skipped");
    expect(h.disables()).toEqual([]);
    expect(readSetupState(h.p).superpowersDisabled ?? []).toEqual([]);
  });

  test("each Claude config folder is handled and recorded on its own", async () => {
    const h = harness({
      sessions: ["1-work"],
      lists: {
        [defaultDir()]: [{ id: "superpowers@claude-plugins-official", enabled: true, scope: "user" }, { id: "superpowers@mattstack", enabled: true, scope: "user" }],
        [sessionDir("1-work")]: [{ id: "superpowers@superpowers-marketplace", enabled: true, scope: "user" }, { id: "superpowers@mattstack", enabled: true, scope: "user" }],
      },
    });
    const outcome = await superpowersForkSwapMigration.run(h.ctx);
    expect(outcome.state).toBe("done");
    expect(readSetupState(h.p).superpowersDisabled).toEqual([
      { configDir: defaultDir(), id: "superpowers@claude-plugins-official" },
      { configDir: sessionDir("1-work"), id: "superpowers@superpowers-marketplace" },
    ]);
  });

  test("mattstack's superpowers not installed yet in a folder: nothing is disabled there, and the run is partial so it retries after plugins.install", async () => {
    const h = harness({ lists: { [defaultDir()]: [{ id: "superpowers@claude-plugins-official", enabled: true, scope: "user" }] } });
    const outcome = await superpowersForkSwapMigration.run(h.ctx);
    expect(outcome.state).toBe("partial");
    expect(h.disables()).toEqual([]);
    expect(readSetupState(h.p).superpowersDisabled ?? []).toEqual([]);
  });

  test("a stock copy enabled only at project scope is out of reach: no disable, skipped", async () => {
    const h = harness({ lists: { [defaultDir()]: [{ id: "superpowers@claude-plugins-official", enabled: true, scope: "project" }] } });
    const outcome = await superpowersForkSwapMigration.run(h.ctx);
    expect(outcome.state).toBe("skipped");
    expect(h.disables()).toEqual([]);
  });

  test("an id that only looks like superpowers is never touched", async () => {
    const h = harness({ lists: { [defaultDir()]: [{ id: "superpowers@superpowers-pinned", enabled: true, scope: "user" }] } });
    expect((await superpowersForkSwapMigration.run(h.ctx)).state).toBe("skipped");
    expect(h.disables()).toEqual([]);
  });

  test("no Claude Code installed: skipped", async () => {
    const h = harness({ claude: false, lists: {} });
    expect((await superpowersForkSwapMigration.run(h.ctx)).state).toBe("skipped");
    expect(h.calls).toEqual([]);
  });

  test("a plugin list that fails is failed, so the migration runs again next launch", async () => {
    const h = harness({ lists: { [defaultDir()]: { code: 1, stdout: "", stderr: "nope" } } });
    expect((await superpowersForkSwapMigration.run(h.ctx)).state).toBe("failed");
    expect(readSetupState(h.p).superpowersDisabled ?? []).toEqual([]);
  });

  test("a disable that fails is failed, and the folders that worked stay recorded", async () => {
    const h = harness({
      sessions: ["1-work"],
      lists: {
        [defaultDir()]: [{ id: "superpowers@claude-plugins-official", enabled: true, scope: "user" }, { id: "superpowers@mattstack", enabled: true, scope: "user" }],
        [sessionDir("1-work")]: [{ id: "superpowers@claude-plugins-official", enabled: true, scope: "user" }, { id: "superpowers@mattstack", enabled: true, scope: "user" }],
      },
      failDisable: (dir) => dir === sessionDir("1-work"),
    });
    expect((await superpowersForkSwapMigration.run(h.ctx)).state).toBe("failed");
    expect(readSetupState(h.p).superpowersDisabled).toEqual([{ configDir: defaultDir(), id: "superpowers@claude-plugins-official" }]);
  });
});
