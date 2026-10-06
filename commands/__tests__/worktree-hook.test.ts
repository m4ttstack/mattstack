import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, userSettingsPath } from "../../lib/rt-paths.ts";
import { claudeHookCommand, hookResultBlocks, hookStatusBlocks, hookInstallCommand, hookStatusCommand, hookUninstallCommand, hookRepoIdentity, parseHookStdin, priorClaudeHookAnswer, recordClaudeHookAnswer, shouldOfferClaudeHook } from "../worktree-hook.ts";
import { loadWorktreeAppConfig } from "../../lib/worktree/config.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { getSetting } from "../../lib/settings/resolve.ts";
import { sharedStorePath } from "../../packages/rt-client/test/org-fixture.ts";

describe("parseHookStdin", () => {
  test("create event yields cwd and name", () => {
    const p = parseHookStdin('{"hook_event_name":"WorktreeCreate","cwd":"/r","name":"probe"}');
    expect(p).toEqual({ event: "create", cwd: "/r", name: "probe" });
  });
  test("remove event carries whichever path field is present", () => {
    expect(parseHookStdin('{"hook_event_name":"WorktreeRemove","worktree_path":"/t"}'))
      .toEqual({ event: "remove", path: "/t" });
    expect(parseHookStdin('{"hook_event_name":"WorktreeRemove","path":"/t"}'))
      .toEqual({ event: "remove", path: "/t" });
  });
  test("garbage is an error result, not a throw", () => {
    expect(parseHookStdin("not json").event).toBe("invalid");
  });
});

describe("hookRepoIdentity", () => {
  test("derivable identity not in the index: null (routes decideCreate to fallback)", () => {
    const result = hookRepoIdentity("/scratch/repo", {
      identityFor: () => "path:%2Fscratch%2Frepo",
      isRegistered: () => false,
      appEnabled: () => true,
    });
    expect(result).toBeNull();
  });

  test("identity already in the index: returned (routes decideCreate to provision)", () => {
    const result = hookRepoIdentity("/known/repo", {
      identityFor: () => "remote:example%2Fr",
      isRegistered: (identity) => identity === "remote:example%2Fr",
      appEnabled: () => true,
    });
    expect(result).toBe("remote:example%2Fr");
  });

  test("no derivable identity at all: null without consulting the index", () => {
    const result = hookRepoIdentity("/not-a-repo", {
      identityFor: () => undefined,
      isRegistered: () => { throw new Error("must not be called"); },
      appEnabled: () => true,
    });
    expect(result).toBeNull();
  });

  test("worktree app disabled: null even for a registered repo, without consulting the index", () => {
    const result = hookRepoIdentity("/known/repo", {
      identityFor: () => "remote:example%2Fr",
      isRegistered: () => { throw new Error("must not be called"); },
      appEnabled: () => false,
    });
    expect(result).toBeNull();
  });
});

describe("shouldOfferClaudeHook", () => {
  const base = { isTTY: true, json: false, batch: false, settingsFileExists: true, hookInstalled: false, priorAnswer: undefined };
  test("offers exactly in the base case", () => expect(shouldOfferClaudeHook(base)).toBe(true));
  test("never offers non-TTY, json, batch, installed, declined, or without a Claude env", () => {
    expect(shouldOfferClaudeHook({ ...base, isTTY: false })).toBe(false);
    expect(shouldOfferClaudeHook({ ...base, json: true })).toBe(false);
    expect(shouldOfferClaudeHook({ ...base, batch: true })).toBe(false);
    expect(shouldOfferClaudeHook({ ...base, hookInstalled: true })).toBe(false);
    expect(shouldOfferClaudeHook({ ...base, priorAnswer: "declined" })).toBe(false);
    expect(shouldOfferClaudeHook({ ...base, settingsFileExists: false })).toBe(false);
  });
});

describe("recordClaudeHookAnswer", () => {
  const REAL_HOME = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rt-claudehook-home-")));
  });

  afterEach(() => {
    if (REAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
  });

  test("recording an answer on a machine with nothing set writes only claudeHook and leaves the pool off", () => {
    expect(loadWorktreeAppConfig()).toEqual({ enabled: false, killProcesses: true });

    recordClaudeHookAnswer("declined");

    expect(loadWorktreeAppConfig()).toEqual({ enabled: false, killProcesses: true });
    const machine = JSON.parse(readFileSync(machineSettingsPath(), "utf8").replace(/^\/\/.*\n/, ""));
    expect(machine["rt.worktreeApp"]).toEqual({ claudeHook: "declined" });
  });

  test("an unowned machine that answered the offer still follows a later team opt-in", () => {
    recordClaudeHookAnswer("declined");
    const team = sharedStorePath("acme");
    mkdirSync(dirname(team), { recursive: true });
    writeFileSync(team, JSON.stringify({ "rt.worktreeApp": { enabled: true } }));

    expect(loadWorktreeAppConfig()).toEqual({ enabled: true, killProcesses: true });
  });

  test("a team-owned key: the machine store gets only claudeHook, never a copy of the team's fields", () => {
    const team = sharedStorePath("acme");
    mkdirSync(dirname(team), { recursive: true });
    writeFileSync(team, JSON.stringify({ "rt.worktreeApp": { enabled: true, killProcesses: false } }));

    recordClaudeHookAnswer("installed");

    const machine = JSON.parse(readFileSync(machineSettingsPath(), "utf8").replace(/^\/\/.*\n/, ""));
    expect(machine["rt.worktreeApp"]).toEqual({ claudeHook: "installed" });
    expect(loadWorktreeAppConfig()).toEqual({ enabled: true, killProcesses: false });
  });

  test("a team-scope claudeHook is ignored: the offer answer is this machine's alone", () => {
    const team = sharedStorePath("acme");
    mkdirSync(dirname(team), { recursive: true });
    writeFileSync(team, JSON.stringify({ "rt.worktreeApp": { enabled: true, claudeHook: "declined" } }));

    expect(priorClaudeHookAnswer()).toBeUndefined();
    recordClaudeHookAnswer("installed");
    expect(priorClaudeHookAnswer()).toBe("installed");
  });

  test("a user-scope claudeHook is ignored, and recording an answer never copies the user's fields", () => {
    const user = userSettingsPath();
    mkdirSync(dirname(user), { recursive: true });
    writeFileSync(user, JSON.stringify({ "rt.worktreeApp": { enabled: true, claudeHook: "declined" } }));

    expect(priorClaudeHookAnswer()).toBeUndefined();
    recordClaudeHookAnswer("installed");

    const machine = JSON.parse(readFileSync(machineSettingsPath(), "utf8").replace(/^\/\/.*\n/, ""));
    expect(machine["rt.worktreeApp"]).toEqual({ claudeHook: "installed" });
    expect(loadWorktreeAppConfig()).toEqual({ enabled: true, killProcesses: true });
  });
});

describe("hookInstallCommand", () => {
  const REAL_HOME = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "rt-hookinstall-home-")));
  });

  afterEach(() => {
    if (REAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
  });

  test("the three hook failures read plainly on stderr", async () => {
    const io = captureOut();
    const fresh = () => {
      io.reset();
      io.clear();
      out.__test__.setHuman(() => false);
    };
    const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c ?? 0}`);
    }) as unknown as typeof process.exit);
    try {
      fresh();
      await expect(hookInstallCommand([], undefined, { which: () => null })).rejects.toThrow("exit 1");
      expect(io.stderr()).toStartWith("rt is not on your PATH\n");
      expect(io.stderr()).toContain("rt must be available before you can install the hook.");
      expect(io.stdout()).toBe("");
      await hookInstallCommand([], undefined, { which: () => "/x/rt" });
      fresh();
      await hookStatusCommand([], undefined);
      expect(io.stderr()).toStartWith("The worktree hook points at an rt that is gone\n");
      fresh();
      writeFileSync(join(process.env.HOME!, ".claude", "settings.json"), "{");
      await expect(hookUninstallCommand([], undefined)).rejects.toThrow("exit 1");
      expect(io.stderr()).toStartWith("rt could not update Claude Code's settings\n");
      expect(io.stdout()).toBe("");
    } finally {
      exit.mockRestore();
      io.restore();
    }
  });

  test("a successful install records the answer so the one-time offer never re-fires", async () => {
    await hookInstallCommand(["--json"], undefined, { which: () => "/usr/local/bin/rt" });
    const stored = getSetting<Record<string, unknown> | undefined>("rt.worktreeApp").value;
    expect(stored?.claudeHook).toBe("installed");
  });

  test("the hook verbs' --json replies, pinned before the output layer", async () => {
    const run = async (fn: () => Promise<void>): Promise<{ code: number; stdout: string }> => {
      const io = captureOut({ console: true });
      const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
        throw new Error(`exit ${c ?? 0}`);
      }) as unknown as typeof process.exit);
      let code = 0;
      try {
        await fn();
      } catch (err) {
        const m = /^exit (\d+)$/.exec((err as Error).message);
        if (!m) throw err;
        code = Number(m[1]);
      } finally {
        exit.mockRestore();
        io.restore();
      }
      return { code, stdout: io.stdout() };
    };
    expect(await run(() => hookStatusCommand(["--json"], undefined))).toEqual({ code: 0, stdout: '{"installed":false}\n' });
    expect(await run(() => hookInstallCommand(["--json"], undefined, { which: () => null }))).toEqual({ code: 1, stdout: '{"error":"rt-not-on-path"}\n' });
    expect(await run(() => hookInstallCommand(["--json"], undefined, { which: () => "/x/rt" }))).toEqual({ code: 0, stdout: '{"installed":true,"changed":true,"rtBin":"/x/rt"}\n' });
    expect(await run(() => hookStatusCommand(["--json"], undefined))).toEqual({ code: 0, stdout: '{"installed":true,"command":"/x/rt worktree claude-hook","binaryExists":false}\n' });
    expect(await run(() => hookUninstallCommand(["--json"], undefined))).toEqual({ code: 0, stdout: '{"installed":false,"changed":true}\n' });
  });
});

describe("the hook verbs a person runs", () => {
  test("status: not installed names the install command", () => {
    expect(renderPlain(hookStatusBlocks({ installed: false } as never))).toBe("[off] The worktree hook is not installed\n  next: rt worktree hook install\n");
  });

  test("status: installed shows what it runs", () => {
    expect(renderPlain(hookStatusBlocks({ installed: true, command: "/opt/rt/bin/rt worktree claude-hook", binaryExists: true } as never))).toBe(
      "[ok] The worktree hook is installed\nruns: /opt/rt/bin/rt worktree claude-hook\n",
    );
  });

  test("install and uninstall say what changed, or that nothing did", () => {
    expect(renderPlain(hookResultBlocks("install", true))).toBe("[ok] Installed the worktree hook  Claude Code now asks rt for a worktree\n");
    expect(renderPlain(hookResultBlocks("install", false))).toBe("[skipped] The worktree hook is already installed\n");
    expect(renderPlain(hookResultBlocks("uninstall", true))).toBe("[ok] Removed the worktree hook\n");
    expect(renderPlain(hookResultBlocks("uninstall", false))).toBe("[skipped] The worktree hook was not installed\n");
  });
});

test("a refusal leaves stdout empty and exits 2", async () => {
  const stdin = spyOn(Bun.stdin, "text").mockResolvedValue("{}");
  const io = captureOut();
  out.__test__.setHuman(() => false);
  const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as unknown as typeof process.exit);
  try {
    await expect(claudeHookCommand([], undefined)).rejects.toThrow("exit 2");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("rt worktree claude-hook: unrecognized stdin payload\n");
  } finally {
    exit.mockRestore();
    stdin.mockRestore();
    io.restore();
  }
});

test("claude-hook writes only the path on stdout", () => {
  const src = readFileSync(join(import.meta.dir, "..", "worktree-hook.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function claudeHookCommand"));
  expect(body.match(/out\.(payload|json|print)\(/g)).toEqual(["out.payload("]);
});
