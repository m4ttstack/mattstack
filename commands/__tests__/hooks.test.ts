/**
 * commands/hooks.ts: the git-hook on/off machinery. `rt.hooks` is the only
 * record of your choices; the installed shim asks `rt hooks enabled <hook>`,
 * which resolves it in-process (lib/git-hooks/__tests__/shims.test.ts covers
 * the shim itself).
 *
 * Every test re-points HOME to a fresh temp dir (the settings/write.test.ts
 * pattern): store files and repoDataDir() both resolve HOME at call time.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  applyHookSelection,
  discoverHooks,
  hookState,
  hooksEnabled,
  runningHooks,
  hooksStatusBlocks,
  loadHooksConfig,
  saveHooksConfig,
  selectionBlocks,
  toggleHooks,
  type HooksConfig,
} from "../hooks.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import { repoDataDir, userSettingsPath } from "../../lib/rt-paths.ts";
import { getDef } from "../../lib/settings/registry.ts";
import { getSetting } from "../../lib/settings/resolve.ts";
import * as settingsResolve from "../../lib/settings/resolve.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../lib/ui/warn.ts";
import { setSetting, setSettingsNoticeSink } from "../../lib/settings/write.ts";

// Captured at module load — before any mock.module runs — so afterEach can
// restore the real daemon client. Top-level await is legal in an ESM test file.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;

const IDENTITY = "example.com/org/repo";

describe("commands/hooks", () => {
  const origHome = process.env.HOME;
  let home: string;
  let dataDir: string;
  let repoRoot: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-hooks-test-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
    dataDir = repoDataDir("repo");
    mkdirSync(dataDir, { recursive: true });
    repoRoot = mkdtempSync(join(tmpdir(), "rt-hooks-repo-"));
    mkdirSync(join(repoRoot, ".husky"));
    writeFileSync(join(repoRoot, ".husky", "pre-commit"), "");
    writeFileSync(join(repoRoot, ".husky", "pre-push"), "");
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeStoreValue(value: unknown): void {
    mkdirSync(join(userSettingsPath(), ".."), { recursive: true });
    writeFileSync(userSettingsPath(), JSON.stringify({ repos: { [IDENTITY]: { "rt.hooks": value } } }));
  }

  describe("loadHooksConfig", () => {
    test("nothing set: the registry default, every hook on", () => {
      expect(getDef("rt.hooks")!.default).toEqual({ enabled: true });
      expect(loadHooksConfig(["pre-commit", "pre-push"], IDENTITY)).toEqual({ enabled: true, hooks: { "pre-commit": true, "pre-push": true } });
    });

    test("an old hooks.json is no longer read", () => {
      writeFileSync(join(dataDir, "hooks.json"), JSON.stringify({ enabled: false, hooks: { "pre-commit": false } }));
      expect(loadHooksConfig(["pre-commit"], IDENTITY)).toEqual({ enabled: true, hooks: { "pre-commit": true } });
    });

    test("a hook the store does not name runs", () => {
      writeStoreValue({ enabled: true, hooks: { "pre-commit": false } });
      expect(loadHooksConfig(["pre-commit", "pre-push"], IDENTITY)).toEqual({ enabled: true, hooks: { "pre-commit": false, "pre-push": true } });
    });
  });

  describe("hookState: what the shim asks", () => {
    function gitRepo(remote: string | null): void {
      execFileSync("git", ["init", "-q", repoRoot]);
      if (remote) execFileSync("git", ["-C", repoRoot, "remote", "add", "origin", remote]);
    }

    test("nothing set: on", () => {
      gitRepo("git@example.com:org/repo.git");
      expect(hookState("pre-push", repoRoot)).toBe("on");
    });

    test("a hook turned off for this repo is off; another hook is on", () => {
      gitRepo("git@example.com:org/repo.git");
      writeStoreValue({ hooks: { "pre-push": false } });
      expect(hookState("pre-push", repoRoot)).toBe("off");
      expect(hookState("pre-commit", repoRoot)).toBe("on");
    });

    test("hooks off for the repo: every hook is off", () => {
      gitRepo("git@example.com:org/repo.git");
      writeStoreValue({ enabled: false });
      expect(hookState("pre-commit", repoRoot)).toBe("off");
    });

    test("a repo with no remote has no settings section, so its hooks run", () => {
      gitRepo(null);
      expect(hookState("pre-push", repoRoot)).toBe("on");
    });

    test("a store rt cannot read: on", () => {
      gitRepo("git@example.com:org/repo.git");
      mkdirSync(join(userSettingsPath(), ".."), { recursive: true });
      writeFileSync(userSettingsPath(), "{not valid json");
      expect(hookState("pre-push", repoRoot)).toBe("on");
    });

    test("no hook named: on", () => {
      expect(hookState(undefined, repoRoot)).toBe("on");
    });

    test("the verb prints only the answer, on stdout", async () => {
      gitRepo("git@example.com:org/repo.git");
      writeStoreValue({ hooks: { "pre-push": false } });
      const io = captureOut();
      const cwd = process.cwd();
      process.chdir(repoRoot);
      try {
        await hooksEnabled(["pre-push"]);
        expect(io.stdout()).toBe("off\n");
        expect(io.stderr()).toBe("");
      } finally {
        process.chdir(cwd);
        io.restore();
      }
    });
  });

  describe("saveHooksConfig", () => {
    test("writes your user settings for this repo and no hooks.json", () => {
      const next: HooksConfig = { enabled: false, hooks: { "pre-commit": false } };
      saveHooksConfig(next, IDENTITY);
      const resolved = getSetting("rt.hooks", { repoIdentity: IDENTITY });
      expect(resolved.value).toEqual(next);
      expect(resolved.provenance.map((p) => p.scope)).toContain("user.repo");
      expect(existsSync(join(dataDir, "hooks.json"))).toBe(false);
    });

    test("a value an older rt wrote on this Mac no longer outranks your choice", () => {
      setSetting("rt.hooks", { enabled: false, hooks: {} }, "machine", { repoIdentity: IDENTITY });
      saveHooksConfig({ enabled: true, hooks: { "pre-commit": true, "pre-push": true } }, IDENTITY);
      const resolved = getSetting<HooksConfig>("rt.hooks", { repoIdentity: IDENTITY });
      expect(resolved.value.enabled).toBe(true);
      expect(resolved.provenance.map((p) => p.scope)).not.toContain("machine.repo");
    });

    test("a store rt cannot write is a failure", () => {
      mkdirSync(join(userSettingsPath(), ".."), { recursive: true });
      writeFileSync(userSettingsPath(), "{not valid json");
      expect(() => saveHooksConfig({ enabled: false, hooks: {} }, IDENTITY)).toThrow("Your hooks choice was not saved");
    });
  });

  // ─── the interactive checklist: ticked means the hook runs ──────────────────

  describe("runningHooks / applyHookSelection", () => {
    const discovered = ["pre-commit", "pre-push"];

    test("the checklist starts from the hooks that actually run", () => {
      expect(runningHooks({ enabled: true, hooks: { "pre-commit": true, "pre-push": false } }, discovered)).toEqual(["pre-commit"]);
      expect(runningHooks({ enabled: false, hooks: { "pre-commit": true, "pre-push": true } }, discovered)).toEqual([]);
    });

    test("ticked hooks run and unticked ones do not", () => {
      const next = applyHookSelection({ enabled: true, hooks: { "pre-commit": true, "pre-push": true } }, discovered, ["pre-commit"]);
      expect(next).toEqual({ enabled: true, hooks: { "pre-commit": true, "pre-push": false } });
    });

    test("ticking a hook while hooks are off for the repo turns them back on", () => {
      const next = applyHookSelection({ enabled: false, hooks: { "pre-commit": true, "pre-push": true } }, discovered, ["pre-push"]);
      expect(next).toEqual({ enabled: true, hooks: { "pre-commit": false, "pre-push": true } });
    });

    test("unticking everything turns hooks off for the repo", () => {
      const next = applyHookSelection({ enabled: true, hooks: { "pre-commit": true, "pre-push": true } }, discovered, []);
      expect(next).toEqual({ enabled: false, hooks: { "pre-commit": false, "pre-push": false } });
    });
  });

  // ─── discoverHooks — unchanged behavior, sanity check ───────────────────────

  test("discoverHooks lists files under .husky, skipping _ and dotfiles", () => {
    writeFileSync(join(repoRoot, ".husky", ".gitignore"), "");
    mkdirSync(join(repoRoot, ".husky", "_"));
    expect(discoverHooks(repoRoot)).toEqual(["pre-commit", "pre-push"]);
  });

  // ─── the hooks:watch daemon nudge sends the SERIALIZED identity ────────────

  describe("toggleHooks daemon nudge", () => {
    let io: ReturnType<typeof captureOut>;
    beforeEach(() => {
      io = captureOut();
      out.__test__.setHuman(() => false);
    });
    afterEach(() => {
      io.restore();
      mock.module("../../lib/daemon-client.ts", () => ({
        ...realDaemonClient,
        daemonQuery: realDaemonQuery,
      }));
    });

    test("hooks:watch is sent ctx.identity.identity, not the display repoName", async () => {
      const calls: { cmd: string; payload?: Record<string, unknown> }[] = [];
      mock.module("../../lib/daemon-client.ts", () => ({
        ...realDaemonClient,
        daemonQuery: async (cmd: string, payload?: Record<string, unknown>) => {
          calls.push({ cmd, payload });
          return { ok: true, data: null };
        },
      }));

      const ctx: CommandContext = {
        identity: { repoName: "repo", identity: "path:%2Frepo", repoRoot, dataDir, remoteUrl: "git@example.com:org/repo.git", baseUrl: "" },
      };

      await toggleHooks(["status"], ctx);
      // The nudge is fire-and-forget (`.then().catch()`, not awaited) —
      // let its microtask land before inspecting captured calls.
      await new Promise((r) => setTimeout(r, 0));

      const call = calls.find((c) => c.cmd === "hooks:watch");
      expect(call).toBeDefined();
      expect(call!.payload!.repo).toBe("path:%2Frepo");
      expect(call!.payload!.repo).not.toBe("repo");
    });
  });

  describe("what a person reads", () => {
    test("hooks that are on: a done line each, and off is never coral", () => {
      expect(renderPlain(hooksStatusBlocks({ enabled: true, hooks: { "pre-commit": true, "pre-push": false } }))).toBe("[ok] Hooks are on\n[ok] pre-commit\n[off] pre-push  off\n");
    });

    test("everything off: every row is off, with what it would be otherwise", () => {
      const text = renderPlain(hooksStatusBlocks({ enabled: false, hooks: { "pre-commit": true, "pre-push": false } }));
      expect(text).toBe("[off] All hooks are off\n[off] pre-commit  on, but everything is off\n[off] pre-push  off\n");
      expect(text).not.toContain("[failed]");
    });

    test("the line after the checklist", () => {
      expect(renderPlain(selectionBlocks([], 2))).toBe("[ok] All hooks run\n");
      expect(renderPlain(selectionBlocks(["pre-commit", "pre-push"], 2))).toBe("[off] All hooks are off\n");
      expect(renderPlain(selectionBlocks(["pre-push"], 2))).toBe("[off] 1 hook off  pre-push\n");
    });

    describe("through toggleHooks", () => {
      let io: ReturnType<typeof captureOut>;
      let exit: ReturnType<typeof spyOn>;
      const ctx = (): CommandContext => ({ identity: { repoName: "repo", identity: "path:%2Frepo", repoRoot, dataDir, remoteUrl: "git@example.com:org/repo.git", baseUrl: "" } });

      beforeEach(() => {
        execFileSync("git", ["init", "-q", repoRoot]);
        io = captureOut();
        out.__test__.setHuman(() => false);
        exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
          throw new Error(`exit ${code}`);
        }) as typeof process.exit);
      });
      afterEach(() => {
        exit.mockRestore();
        io.restore();
      });

      test("outside a git repo, the hook folder warning is a warn line, not a failure", async () => {
        rmSync(join(repoRoot, ".git"), { recursive: true, force: true });
        await toggleHooks(["status"], ctx());
        expect(io.lines()[0]).toBe("[warning] Git was not pointed at rt's hook folder  your choice will not take effect");
        expect(io.stderr()).toBe("");
      });

      test("off says so, in plain words, on stdout", async () => {
        await toggleHooks(["off"], ctx());
        expect(io.stdout()).toBe("[off] All hooks are off  repo\n  note: This applies in every git app: the terminal, Cursor, GitHub Desktop.\n");
        expect(io.stderr()).toBe("");
      });

      test("one hook off, then on", async () => {
        await toggleHooks(["pre-push", "off"], ctx());
        await toggleHooks(["pre-push", "on"], ctx());
        expect(io.lines()).toEqual(["[off] pre-push is off  repo", "[ok] pre-push is on  repo"]);
      });

      test("a hook this repo does not have is a failure that lists the ones it has, exit 1", async () => {
        await expect(toggleHooks(["pre-rebase", "off"], ctx())).rejects.toThrow("exit 1");
        expect(io.stderr()).toBe("This repo has no hook called pre-rebase\n  why: The hooks here are pre-commit, pre-push.\n");
        expect(io.stdout()).toBe("");
      });

      test("a repo with no husky hooks is a failure, exit 1", async () => {
        rmSync(join(repoRoot, ".husky"), { recursive: true, force: true });
        await expect(toggleHooks(["status"], ctx())).rejects.toThrow("exit 1");
        expect(io.stderr()).toBe("This repo has no husky hooks\n  why: rt turns hooks on and off for repos that keep them in a .husky folder.\n");
      });

      test("off installs shims that ask rt, and writes no hooks.json", async () => {
        await toggleHooks(["off"], ctx());
        expect(readFileSync(join(dataDir, "hooks", "pre-push"), "utf8")).toContain("hooks enabled");
        expect(existsSync(join(dataDir, "hooks.json"))).toBe(false);
      });

      test("a repo with no remote is refused, and nothing is installed", async () => {
        const noRemote: CommandContext = { identity: { repoName: "repo", identity: "path:%2Frepo", repoRoot, dataDir, remoteUrl: "", baseUrl: "" } };
        await expect(toggleHooks(["off"], noRemote)).rejects.toThrow("exit 1");
        expect(io.stderr()).toBe("[refused] This repo has no remote, so rt has nowhere to keep its hook choices\n");
        expect(io.stdout()).toBe("");
        expect(existsSync(join(dataDir, "hooks"))).toBe(false);
      });
    });

    test("a hooks setting rt cannot read is shown once and logged", () => {
      const io = captureOut();
      out.__test__.setHuman(() => false);
      warnTest.reset();
      const logged: string[] = [];
      setWarningLog((_module, message) => {
        logged.push(message);
      });
      const probe = spyOn(settingsResolve, "getSetting").mockImplementation(() => {
        throw new Error("rt.hooks: expected an object\n  at $.hooks");
      });
      try {
        loadHooksConfig(["pre-commit"], IDENTITY);
        loadHooksConfig(["pre-commit"], IDENTITY);
        expect(io.stderr()).toBe("[warning] Your hooks setting is being ignored  rt.hooks: expected an object\n  next: rt settings check\n");
        expect(io.stdout()).toBe("");
        expect(logged).toHaveLength(2);
        expect(logged[0]).toStartWith('ignoring "rt.hooks" -- rt.hooks: expected an object');
      } finally {
        probe.mockRestore();
        warnTest.reset();
        io.restore();
      }
    });
  });
});
