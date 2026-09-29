/**
 * `rt daemon logs` is run by the tray under launchd's minimal PATH, and the
 * tray opens the viewer itself, so the command must find logdy without
 * Homebrew on PATH, open the browser only when asked to, and exit nonzero
 * with a one-line reason on stderr whenever there is no viewer to open.
 */

import { describe, expect, test } from "bun:test";
import { runWebViewer, type WebViewerSeams } from "../daemon.ts";

class Exited extends Error {
  constructor(readonly code: number) { super(`exit ${code}`); }
}

function fakeSeams(over: Partial<WebViewerSeams> = {}) {
  const calls = { opened: [] as string[], spawned: [] as { bin: string; args: string[] }[], errors: [] as string[], killed: 0 };
  const seams: WebViewerSeams = {
    findLogdy: () => "/Applications/mattstack.app/Contents/Helpers/logdy",
    materializeConfig: () => "/tmp/logdy.json",
    spawnLogdy: (bin, args) => {
      calls.spawned.push({ bin, args });
      return { kill: () => { calls.killed += 1; }, onExit: () => {} };
    },
    waitForPort: async () => true,
    openUrl: (url) => { calls.opened.push(url); },
    onSignal: () => {},
    exit: (code) => { throw new Exited(code); },
    log: () => {},
    error: (line) => { calls.errors.push(line); },
    ...over,
  };
  return { seams, calls };
}

describe("runWebViewer", () => {
  test("spawns the resolved logdy, not a bare name", async () => {
    const { seams, calls } = fakeSeams();
    await runWebViewer(["/logs/daemon.log"], { open: true }, seams);
    expect(calls.spawned[0]?.bin).toBe("/Applications/mattstack.app/Contents/Helpers/logdy");
    expect(calls.spawned[0]?.args.slice(0, 2)).toEqual(["follow", "/logs/daemon.log"]);
  });

  test("opens the browser once logdy answers", async () => {
    const { seams, calls } = fakeSeams();
    await runWebViewer(["/logs/daemon.log"], { open: true }, seams);
    expect(calls.opened).toEqual(["http://localhost:5544"]);
  });

  test("--no-open leaves the browser to the caller", async () => {
    const { seams, calls } = fakeSeams();
    await runWebViewer(["/logs/daemon.log"], { open: false }, seams);
    expect(calls.opened).toEqual([]);
    expect(calls.spawned.length).toBe(1);
  });

  test("missing logdy exits 1 with the reason as the first stderr line", async () => {
    const { seams, calls } = fakeSeams({ findLogdy: () => null });
    await expect(runWebViewer(["/logs/daemon.log"], { open: true }, seams)).rejects.toEqual(new Exited(1));
    expect(calls.errors[0]).toMatch(/^logdy not found/);
    expect(calls.spawned).toEqual([]);
    expect(calls.opened).toEqual([]);
  });

  test("logdy that never answers exits 1, kills it, and opens nothing", async () => {
    const { seams, calls } = fakeSeams({ waitForPort: async () => false });
    await expect(runWebViewer(["/logs/daemon.log"], { open: true }, seams)).rejects.toEqual(new Exited(1));
    expect(calls.errors[0]).toMatch(/^logdy did not answer on :5544/);
    expect(calls.killed).toBe(1);
    expect(calls.opened).toEqual([]);
  });

  test("logdy exiting before it answers names its exit code on stderr", async () => {
    let exitCb: ((code: number | null) => void) | undefined;
    const { seams, calls } = fakeSeams({
      spawnLogdy: () => ({ kill: () => {}, onExit: (cb) => { exitCb = cb; } }),
      waitForPort: async () => {
        exitCb?.(1);
        return false;
      },
    });
    await expect(runWebViewer(["/logs/daemon.log"], { open: true }, seams)).rejects.toEqual(new Exited(1));
    expect(calls.errors[0]).toBe("logdy exited 1 before answering on :5544");
  });
});
