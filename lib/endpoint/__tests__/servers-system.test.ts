import { describe, expect, test } from "bun:test";
import type { RunResult } from "../../subprocess.ts";
import type { RunningServer } from "../servers.ts";
import { readServerSnapshot, stopServers, type ServerSystem } from "../servers-system.ts";

const LSTART = "Tue Nov 24 14:45:47 2026";
const PS = `   10     1 18:00:00 ${LSTART}     rt intercept run doppler -- run -- parcel\n   11    10 18:00:00 ${LSTART}     parcel src/index.html\n`;
const CWDS = "p10\nfcwd\nn/trees/calm-marble/apps/web\np11\nfcwd\nn/trees/calm-marble/apps/web\n";
const LISTENERS = "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 11 me 22u IPv4 0x1 0t0 TCP *:9229 (LISTEN)\nnode 11 me 23u IPv6 0x2 0t0 TCP [::1]:4001 (LISTEN)\n";
const WORKTREES = [{ path: "/code/sample-app", branch: "main" }, { path: "/trees/calm-marble", branch: null }];

function ok(stdout: string): RunResult {
  return { stdout, stderr: "", exitCode: 0 };
}

const TIMED_OUT: RunResult = { stdout: "", stderr: "", exitCode: -1, timedOut: true };

interface Reads { ps?: RunResult; cwds?: RunResult; listeners?: RunResult; worktrees?: typeof WORKTREES | null }

function readSystem(reads: Reads = {}) {
  const calls: Array<{ argv: string[]; opts: { timeoutMs: number; env?: Record<string, string | undefined> } }> = [];
  const system: ServerSystem = {
    run: async (argv, opts) => {
      calls.push({ argv, opts });
      if (argv[0] === "ps") return reads.ps ?? ok(PS);
      return argv.includes("cwd") ? reads.cwds ?? ok(CWDS) : reads.listeners ?? ok(LISTENERS);
    },
    worktrees: async () => (reads.worktrees === undefined ? WORKTREES : reads.worktrees),
    signal: () => { throw new Error("a read never signals"); },
    sleep: async () => {},
  };
  return { system, calls };
}

const read = (reads: Reads = {}) => readServerSnapshot("/code/sample-app", readSystem(reads).system);

describe("readServerSnapshot", () => {
  test("the snapshot joins processes, folders, ports and worktrees", async () => {
    expect(await read()).toEqual({
      procs: [
        { pid: 10, ppid: 1, etime: "18:00:00", startTime: LSTART, args: "rt intercept run doppler -- run -- parcel" },
        { pid: 11, ppid: 10, etime: "18:00:00", startTime: LSTART, args: "parcel src/index.html" },
      ],
      cwds: new Map([[10, "/trees/calm-marble/apps/web"], [11, "/trees/calm-marble/apps/web"]]),
      listeners: new Map([[11, [4001, 9229]]]),
      worktrees: WORKTREES,
    });
  });

  test("ps runs under LC_ALL=C, because lstart follows the locale", async () => {
    const { system, calls } = readSystem();
    await readServerSnapshot("/code/sample-app", system);
    const ps = calls.find((c) => c.argv[0] === "ps")!;
    expect(ps.opts.env!.LC_ALL).toBe("C");
    expect(ps.opts.env!.PATH).toBe(process.env.PATH);
  });

  test("every read that fails is null, never a machine with nothing running", async () => {
    expect(await read({ ps: { stdout: PS, stderr: "", exitCode: 1 } })).toBeNull();
    expect(await read({ ps: TIMED_OUT })).toBeNull();
    expect(await read({ ps: ok("no rows this can read\n") })).toBeNull();
    expect(await read({ cwds: TIMED_OUT })).toBeNull();
    expect(await read({ cwds: ok("") })).toBeNull();
    expect(await read({ cwds: { stdout: CWDS, stderr: "", exitCode: 143 } })).toBeNull();
    expect(await read({ listeners: TIMED_OUT })).toBeNull();
    expect(await read({ listeners: { stdout: LISTENERS, stderr: "", exitCode: 143 } })).toBeNull();
    expect(await read({ worktrees: null })).toBeNull();
  });

  test("a listener read that exits 1 with no output is no listeners, not a failure", async () => {
    expect((await read({ listeners: { stdout: "", stderr: "", exitCode: 1 } }))!.listeners.size).toBe(0);
  });

  test("a cwd read that exits 1 after printing its rows is kept", async () => {
    expect((await read({ cwds: { stdout: CWDS, stderr: "", exitCode: 1 } }))!.cwds.size).toBe(2);
  });
});

function server(pid: number, pids: number[], over: Partial<RunningServer> = {}): RunningServer {
  return {
    role: "api", port: 10400, listening: true, worktree: { path: "/trees/calm-marble", name: "calm-marble" }, branch: "feature/login",
    pid, pids, startTime: LSTART, etime: "18:00:00", leftBehind: false, agent: null, ...over,
  };
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** A process table where each pid dies on SIGTERM unless it is listed in one of the sets. */
function stopSystem(over: { ignoresTerm?: number[]; ignoresKill?: number[]; denied?: number[]; gone?: number[] } = {}) {
  const dead = new Set(over.gone ?? []);
  const sent: Array<[number, string]> = [];
  let slept = 0;
  const system: ServerSystem = {
    run: async () => { throw new Error("a stop never reads"); },
    worktrees: async () => { throw new Error("a stop never reads"); },
    signal: (pid, sig) => {
      if (over.denied?.includes(pid)) throw errno("EPERM");
      if (dead.has(pid)) throw errno("ESRCH");
      if (sig === 0) return;
      sent.push([pid, sig]);
      if (sig === "SIGTERM" && !over.ignoresTerm?.includes(pid)) dead.add(pid);
      if (sig === "SIGKILL" && !over.ignoresKill?.includes(pid)) dead.add(pid);
    },
    sleep: async (ms) => { slept += ms; },
  };
  return { system, sent, slept: () => slept, killed: () => sent.filter(([, sig]) => sig === "SIGKILL").map(([pid]) => pid) };
}

const NONE = new Set<number>();

describe("stopServers", () => {
  test("stopping signals every pid in the tree with SIGTERM", async () => {
    const io = stopSystem();
    const one = server(10, [10, 11, 12]);
    expect(await stopServers([one], [one], NONE, io.system)).toEqual([{ server: one, result: "stopped" }]);
    expect(io.sent).toEqual([[10, "SIGTERM"], [11, "SIGTERM"], [12, "SIGTERM"]]);
  });

  test("the fresh tree's pids are the ones signalled", async () => {
    const io = stopSystem();
    await stopServers([server(10, [10, 11])], [server(10, [10, 12])], NONE, io.system);
    expect(io.sent.map(([pid]) => pid)).toEqual([10, 12]);
  });

  test("what is left after 5 seconds gets SIGKILL", async () => {
    const io = stopSystem({ ignoresTerm: [12] });
    const one = server(10, [10, 11, 12]);
    expect((await stopServers([one], [one], NONE, io.system))[0]!.result).toBe("stopped");
    expect(io.killed()).toEqual([12]);
    expect(io.slept()).toBeGreaterThanOrEqual(5_000);
  });

  test("a tree that stops at once is not waited on", async () => {
    const io = stopSystem();
    const one = server(10, [10]);
    await stopServers([one], [one], NONE, io.system);
    expect(io.slept()).toBeLessThanOrEqual(100);
    expect(io.killed()).toEqual([]);
  });

  test("what survives SIGKILL is a failure that says so", async () => {
    const io = stopSystem({ ignoresTerm: [12], ignoresKill: [12] });
    const one = server(10, [10, 12]);
    expect(await stopServers([one], [one], NONE, io.system)).toEqual([{ server: one, result: "failed", why: "It did not stop." }]);
    expect(io.slept()).toBeLessThanOrEqual(7_100);
  });

  test("a server missing from the fresh list, or with a new start time, is gone and never signalled", async () => {
    const io = stopSystem();
    const missing = server(10, [10]);
    const reused = server(20, [20]);
    const outcomes = await stopServers([missing, reused], [server(20, [20], { startTime: "Wed Nov 25 09:00:00 2026" })], NONE, io.system);
    expect(outcomes).toEqual([{ server: missing, result: "gone" }, { server: reused, result: "gone" }]);
    expect(io.sent).toEqual([]);
  });

  test("a process owned by someone else is a failure that says why", async () => {
    const io = stopSystem({ denied: [11] });
    const one = server(10, [10, 11]);
    expect(await stopServers([one], [one], NONE, io.system)).toEqual([{ server: one, result: "failed", why: "It belongs to another user or to macOS." }]);
    expect(io.slept()).toBeLessThanOrEqual(100);
  });

  test("a pid that is already gone when signalled is not a failure", async () => {
    const io = stopSystem({ gone: [11] });
    const one = server(10, [10, 11]);
    expect((await stopServers([one], [one], NONE, io.system))[0]!.result).toBe("stopped");
  });

  test("a survivor that exits just before SIGKILL is not a failure", async () => {
    const io = stopSystem({ ignoresTerm: [11] });
    const signal: ServerSystem["signal"] = (pid, sig) => {
      if (sig === "SIGKILL") throw errno("ESRCH");
      if (sig === 0 && io.slept() > 5_000) throw errno("ESRCH");
      io.system.signal(pid, sig);
    };
    const one = server(10, [11]);
    expect((await stopServers([one], [one], NONE, { ...io.system, signal }))[0]!.result).toBe("stopped");
  });

  test("spared pids and pids of 1 or less are never signalled", async () => {
    const io = stopSystem();
    const one = server(10, [0, 1, 10, 11]);
    await stopServers([one], [one], new Set([11]), io.system);
    expect(io.sent).toEqual([[10, "SIGTERM"]]);
  });

  test("a server rt itself runs inside is left alone and says why", async () => {
    const io = stopSystem();
    const one = server(10, [10, 11, 12]);
    expect(await stopServers([one], [one], new Set([10, 11]), io.system)).toEqual([{ server: one, result: "failed", why: "rt is running inside it." }]);
    expect(io.sent).toEqual([]);
  });

  test("several servers share one wait, and each reports its own result", async () => {
    const io = stopSystem({ ignoresTerm: [21, 31], ignoresKill: [31] });
    const all = [server(10, [10]), server(20, [20, 21]), server(30, [30, 31])];
    const outcomes = await stopServers(all, all, NONE, io.system);
    expect(outcomes.map((o) => o.result)).toEqual(["stopped", "stopped", "failed"]);
    expect(io.slept()).toBeLessThanOrEqual(7_100);
  });
});
