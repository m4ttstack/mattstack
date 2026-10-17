import { describe, test, expect } from "bun:test";
import pino from "pino";
import type { Logger } from "pino";
import { createBgService, bgSocketPath, defaultProbePane } from "../bg-service.ts";
import type { HerdrRunner } from "../../agent-herdr.ts";

const log = pino({ level: "silent" });

/** Never lands real subprocess calls: the login-shell env and the parity
    probes go through these unless a test overrides them. */
const loginEnv = { PATH: "/probed/bin", HOME: "/probed/home", SHELL: "/probed/bin/zsh", TMPDIR: "/probed/tmp", LANG: "en_US.UTF-8" };
const quietLogin = async () => loginEnv;
const matchingProbe = async () => "bun\nnode\nclaude\nrt\ngit\n/probed/bin";

function silent(warns?: unknown[][]): Logger {
  return {
    info: () => {},
    warn: (...a: unknown[]) => { warns?.push(a); },
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
}

describe("bg service", () => {
  test("socket path is the named-session socket under the config dir", () => {
    expect(bgSocketPath("/h")).toBe("/h/.config/herdr/sessions/bg/herdr.sock");
  });

  test("ensure returns immediately when the server is already up", async () => {
    const spawned: string[][] = [];
    const s = createBgService({ log, home: "/h", available: async () => true, spawn: (argv) => { spawned.push(argv); } });
    expect(await s.ensure()).toEqual({ socket: "/h/.config/herdr/sessions/bg/herdr.sock", started: false });
    expect(spawned).toEqual([]);
  });

  test("ensure spawns `herdr server` detached in the user context with HERDR_SESSION and no HERDR_SOCKET_PATH, then waits for the socket", async () => {
    let calls = 0;
    const spawned: Array<{ argv: string[]; env: Record<string, string>; cwd: string }> = [];
    const prior = process.env.HERDR_SOCKET_PATH;
    process.env.HERDR_SOCKET_PATH = "/visible/herdr.sock";
    try {
      const s = createBgService({
        log, home: "/h", readyTimeoutMs: 500,
        available: async () => ++calls > 2,
        spawn: (argv, env, cwd) => { spawned.push({ argv, env, cwd }); },
        loginEnv: quietLogin,
        probePane: matchingProbe,
      });
      const result = await s.ensure();
      expect(result).toEqual({ socket: "/h/.config/herdr/sessions/bg/herdr.sock", started: true });
    } finally {
      if (prior === undefined) delete process.env.HERDR_SOCKET_PATH;
      else process.env.HERDR_SOCKET_PATH = prior;
    }
    expect(spawned[0]!.argv).toEqual([expect.stringMatching(/herdr$/), "server"]);
    expect(spawned[0]!.cwd).toBe("/h");
    const env = spawned[0]!.env;
    expect(env.HERDR_SESSION).toBe("bg");
    expect(env.HERDR_MACOS_SERVER_CONTEXT).toBe("user");
    expect("HERDR_SOCKET_PATH" in env).toBe(false);
    expect("RT_BATCH" in env).toBe(false);
  });

  test("ensure fails loudly when the socket never appears", async () => {
    const s = createBgService({ log, home: "/h", readyTimeoutMs: 50, available: async () => false, spawn: () => {}, loginEnv: quietLogin });
    await expect(s.ensure()).rejects.toThrow(/did not come up.*\/h\/\.config\/herdr\/herdr-server\.log/);
  });

  test("concurrent ensures join the launch already running instead of spawning a second server", async () => {
    let calls = 0;
    const spawned: string[][] = [];
    const s = createBgService({
      log, home: "/h", readyTimeoutMs: 500,
      available: async () => ++calls > 2,
      spawn: (argv) => { spawned.push(argv); },
      loginEnv: quietLogin,
      probePane: matchingProbe,
    });
    const [a, b] = await Promise.all([s.ensure(), s.ensure()]);
    expect(spawned).toHaveLength(1);
    expect(a).toEqual({ socket: "/h/.config/herdr/sessions/bg/herdr.sock", started: true });
    expect(b).toEqual(a);
  });

  test("a retry after a timed-out launch refuses to spawn a second server", async () => {
    const spawned: string[][] = [];
    const s = createBgService({
      log, home: "/h", readyTimeoutMs: 50,
      available: async () => false,
      spawn: (argv) => { spawned.push(argv); },
      loginEnv: quietLogin,
    });
    await expect(s.ensure()).rejects.toThrow(/did not come up/);
    await expect(s.ensure()).rejects.toThrow(/has not bound/);
    expect(spawned).toHaveLength(1);
  });

  // A crash right after a successful bind must not read as "still within
  // this spawn's cooldown": the stamp clears on the success path, so a
  // socket that vanishes afterward gets a fresh spawn attempt, not the
  // misleading "has not bound yet" refusal.
  test("a successful ensure resets the spawn stamp so a socket that later disappears relaunches", async () => {
    const spawned: string[][] = [];
    let up = false; let spawnCount = 0;
    const s = createBgService({
      log, home: "/h", readyTimeoutMs: 200,
      available: async () => up,
      spawn: (argv) => { spawned.push(argv); spawnCount += 1; if (spawnCount === 1) up = true; },
      loginEnv: quietLogin,
      probePane: matchingProbe,
    });
    expect(await s.ensure()).toEqual({ socket: "/h/.config/herdr/sessions/bg/herdr.sock", started: true });
    expect(spawned).toHaveLength(1);
    up = false;
    await expect(s.ensure()).rejects.toThrow(/did not come up/);
    expect(spawned).toHaveLength(2);
  });

  test("stop resets the spawn stamp so a subsequent ensure is not blocked by the cooldown", async () => {
    const spawned: string[][] = [];
    const s = createBgService({
      log, home: "/h", readyTimeoutMs: 50,
      available: async () => false,
      spawn: (argv) => { spawned.push(argv); },
      loginEnv: quietLogin,
      run: async () => ({ exitCode: 0, stdout: "" }),
    });
    await expect(s.ensure()).rejects.toThrow(/did not come up/);
    expect(spawned).toHaveLength(1);
    await s.stop();
    await expect(s.ensure()).rejects.toThrow(/did not come up/);
    expect(spawned).toHaveLength(2);
  });

  test("stop runs `herdr session stop bg` without HERDR_SOCKET_PATH", async () => {
    const runs: Array<{ argv: string[]; env: Record<string, string> }> = [];
    const s = createBgService({ log, home: "/h", run: async (argv, env) => { runs.push({ argv, env }); return { exitCode: 0, stdout: "" }; } });
    await s.stop();
    expect(runs[0]!.argv.slice(-3)).toEqual(["session", "stop", "bg"]);
    expect("HERDR_SOCKET_PATH" in runs[0]!.env).toBe(false);
  });

  test("ensure builds the spawned server's env from the login-shell env, not the daemon's own PATH", async () => {
    let calls = 0;
    const spawned: Array<{ env: Record<string, string> }> = [];
    const s = createBgService({
      log, home: "/h", readyTimeoutMs: 500,
      available: async () => ++calls > 2,
      spawn: (argv, env) => { spawned.push({ env }); },
      loginEnv: quietLogin,
      probePane: matchingProbe,
    });
    await s.ensure();
    const env = spawned[0]!.env;
    expect(env.PATH).toBe(loginEnv.PATH);
    expect(env.HOME).toBe(loginEnv.HOME);
    expect(env.SHELL).toBe(loginEnv.SHELL);
    expect(env.TMPDIR).toBe(loginEnv.TMPDIR);
    expect(env.LANG).toBe(loginEnv.LANG);
    expect(env.PATH).not.toBe(process.env.PATH);
  });

  test("an empty login-shell env falls back to the daemon's own PATH and warns, without failing ensure", async () => {
    const warns: unknown[][] = [];
    let calls = 0;
    const spawned: Array<{ env: Record<string, string> }> = [];
    const s = createBgService({
      log: silent(warns), home: "/h", readyTimeoutMs: 500,
      available: async () => ++calls > 2,
      spawn: (argv, env) => { spawned.push({ env }); },
      loginEnv: async () => ({}),
      probePane: matchingProbe,
    });
    const result = await s.ensure();
    expect(result.started).toBe(true);
    expect(spawned[0]!.env.PATH).toBe(process.env.PATH);
    expect(warns.some((a) => String(a[0]).includes("login-shell env unavailable"))).toBe(true);
  });

  test("a fresh start runs a parity probe and records drift when a binary resolves differently", async () => {
    let calls = 0;
    const probes: Array<string | null> = [];
    const s = createBgService({
      log, home: "/h", readyTimeoutMs: 500,
      available: async () => ++calls > 2,
      spawn: () => {},
      loginEnv: quietLogin,
      probePane: async (socket) => {
        probes.push(socket);
        return socket === null
          ? "/usr/local/bin/bun\nnode\nclaude\n/usr/local/bin/rt\ngit\n/visible/path"
          : "/opt/bun\nnode\nclaude\n/opt/rt\ngit\n/bg/path";
      },
    });
    await s.ensure();
    expect(probes).toEqual(["/h/.config/herdr/sessions/bg/herdr.sock", null]);
    const parity = s.lastParity();
    expect(parity?.ok).toBe(false);
    expect(parity?.drift.some((d) => d.startsWith("bun:"))).toBe(true);
    expect(parity?.drift.some((d) => d.startsWith("rt:"))).toBe(true);
    expect(parity?.drift.some((d) => d.startsWith("PATH:"))).toBe(true);
    expect(parity?.drift.some((d) => d.startsWith("node:"))).toBe(false);
  });

  test("a fresh start with matching probes records ok parity and no drift", async () => {
    let calls = 0;
    const s = createBgService({
      log, home: "/h", readyTimeoutMs: 500,
      available: async () => ++calls > 2,
      spawn: () => {},
      loginEnv: quietLogin,
      probePane: matchingProbe,
    });
    await s.ensure();
    expect(s.lastParity()).toEqual({ ok: true, drift: [] });
  });

  test("a parity probe failure is tolerated: ensure still returns the socket and warns, lastParity stays null", async () => {
    const warns: unknown[][] = [];
    let calls = 0;
    const s = createBgService({
      log: silent(warns), home: "/h", readyTimeoutMs: 500,
      available: async () => ++calls > 2,
      spawn: () => {},
      loginEnv: quietLogin,
      probePane: async () => { throw new Error("herdr not found"); },
    });
    const result = await s.ensure();
    expect(result).toEqual({ socket: "/h/.config/herdr/sessions/bg/herdr.sock", started: true });
    expect(s.lastParity()).toBeNull();
    expect(warns.some((a) => String(a[1] ?? "").includes("parity probe failed"))).toBe(true);
  });

  test("defaultProbePane closes the throwaway workspace even when the pane read rejects", async () => {
    const calls: string[][] = [];
    const runner: HerdrRunner = async (args) => {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") return { stdout: JSON.stringify({ result: { workspaces: [] } }), exitCode: 0 };
      if (args[0] === "workspace" && args[1] === "create") {
        return { stdout: JSON.stringify({ result: { root_pane: { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" } } }), exitCode: 0 };
      }
      if (args[0] === "pane" && args[1] === "read") throw new Error("pane read failed");
      return { stdout: "{}", exitCode: 0 };
    };
    await expect(defaultProbePane(null, "echo hi", runner)).rejects.toThrow("pane read failed");
    expect(calls.some((c) => c[0] === "workspace" && c[1] === "close" && c[2] === "w1")).toBe(true);
  });

  // defaultProbePane launches its throwaway pane into a shared "bg-probe"
  // workspace label; running both sides concurrently is a create-create
  // race against that label. Pins the fix: the bg-socket probe must finish
  // before the visible-server probe starts.
  test("reprobe runs the bg probe and the visible probe sequentially, not concurrently", async () => {
    const events: string[] = [];
    let resolveBg: (() => void) | undefined;
    const s = createBgService({
      log, home: "/h",
      available: async () => true,
      probePane: async (socket) => {
        const label = socket === null ? "visible" : "bg";
        events.push(`start:${label}`);
        if (label === "bg") await new Promise<void>((resolve) => { resolveBg = resolve; });
        events.push(`end:${label}`);
        return "same";
      },
    });
    const reprobe = s.reprobe();
    await Bun.sleep(10);
    expect(events).toEqual(["start:bg"]);
    resolveBg?.();
    await reprobe;
    expect(events).toEqual(["start:bg", "end:bg", "start:visible", "end:visible"]);
  });

  test("reprobe re-runs both probes against a running server and updates lastParity", async () => {
    const s = createBgService({
      log, home: "/h",
      available: async () => true,
      probePane: async (socket) => (socket === null ? "same" : "same"),
    });
    expect(s.lastParity()).toBeNull();
    const report = await s.reprobe();
    expect(report).toEqual({ ok: true, drift: [] });
    expect(s.lastParity()).toEqual(report);
  });
});
