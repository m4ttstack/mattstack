import type { Block } from "../../lib/ui/protocol.ts";
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
  const calls = { opened: [] as string[], spawned: [] as { bin: string; args: string[] }[], printed: [] as Block[], failures: [] as out.FailureInput[], killed: 0 };
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
    print: (...blocks) => { calls.printed.push(...blocks); },
    fail: (f) => { calls.failures.push(f); },
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
    expect(calls.failures[0]?.title).toMatch(/^rt could not find logdy/);
    expect(calls.spawned).toEqual([]);
    expect(calls.opened).toEqual([]);
  });

  test("logdy that never answers exits 1, kills it, and opens nothing", async () => {
    const { seams, calls } = fakeSeams({ waitForPort: async () => false });
    await expect(runWebViewer(["/logs/daemon.log"], { open: true }, seams)).rejects.toEqual(new Exited(1));
    expect(calls.failures[0]?.title).toMatch(/^The log viewer did not start in time/);
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
    expect(calls.failures[0]?.title).toBe("The log viewer stopped before it opened");
    expect(calls.failures[0]?.why).toBe("logdy exited 1.");
  });
});

import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

test("the first stderr line of a missing logdy is the failure title alone", async () => {
  const io = captureOut();
  out.__test__.setHuman(() => false);
  try {
    const { seams } = fakeSeams({ findLogdy: () => null, fail: (f) => out.fail(f) });
    await expect(runWebViewer(["/logs/daemon.log"], { open: true }, seams)).rejects.toThrow("exit 1");
    expect(io.stderr()).toStartWith("rt could not find logdy\n");
    expect(io.stdout()).toBe("");
  } finally {
    io.restore();
  }
});

test("an early logdy exit and a slow logdy are failures the tray can show", async () => {
  const early = fakeSeams({ spawnLogdy: (_b, _a) => ({ kill: () => {}, onExit: (cb) => cb(3) }), waitForPort: async () => false });
  await expect(runWebViewer([], { open: false }, early.seams)).rejects.toThrow();
  expect(early.calls.failures[0]?.title).toBe("The log viewer stopped before it opened");
  const slow = fakeSeams({ waitForPort: async () => false });
  await expect(runWebViewer([], { open: false }, slow.seams)).rejects.toThrow("exit 1");
  expect(slow.calls.failures.at(-1)?.title).toBe("The log viewer did not start in time");
});
