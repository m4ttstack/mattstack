import { expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { flavorInfoBlocks, statusBlocks, tupleWarningBlocks } from "../daemon.ts";

const plain = (v: unknown, now = 0) => {
  const r = statusBlocks(v as never, now);
  return renderPlain([...r.print, ...(r.failure ? [out.failure(r.failure)] : [])]);
};

test("running: a line, then what it watches", () => {
  const text = plain({ state: "running", data: { pid: 42, uptime: 3_720_000, watchedRepos: 3, cacheEntries: 10 } });
  expect(text).toStartWith("[running] The daemon is running  pid 42, up 1h 2m\n");
  expect(text).toContain("watching: 3 repos");
  expect(text).toContain("cache: 10 entries");
});

test("running prints the health level and reasons when present", () => {
  const text = plain({ state: "running", data: { pid: 42, uptime: 60_000, watchedRepos: 3, cacheEntries: 10, health: { level: "degraded", reasons: ["refresh: 3 repos failing (auth?)"] } } });
  expect(text).toContain("[warning] The daemon reports it is degraded");
  expect(text).toContain("refresh: 3 repos failing (auth?)");
});

test("a hostile health reason cannot repaint the screen", () => {
  const text = plain({ state: "running", data: { pid: 1, uptime: 1, watchedRepos: 0, cacheEntries: 0, health: { level: "unhealthy", reasons: ["x\x1b[2Jy"] } } });
  expect(text).not.toContain("\x1b");
  expect(text).toContain("[warning] The daemon reports it is unhealthy");
});

test("degraded/unresponsive names the slowest pause, never 'probably mid-sync'", () => {
  const text = plain({ state: "degraded", reason: "unresponsive", pid: 42, eventLoop: { maxLagMs: 1400, lastStallAt: 1, lastStallCmd: "mr:action", stalls: 2 } });
  expect(text).toContain("[warning] The daemon is running but did not report its status  pid 42");
  expect(text).toContain("1400 ms, in mr:action");
  expect(text).not.toContain("mid-sync");
  expect(text).toContain("next: rt daemon logs");
});

test("alive-not-serving 'stalled' says how long it has been quiet", () => {
  expect(plain({ state: "alive-not-serving", pid: 42, detail: "stalled", stalledForMs: 8000 })).toContain("It has not checked in for 8 seconds.");
});

test("crash-looping and boot-failed are the only failures", () => {
  expect(statusBlocks({ state: "crash-looping", failures: 4, reason: "segfault" } as never, 0).failure).toEqual({ title: "The daemon keeps crashing", hint: "4 failures recently", why: "segfault", next: out.cmd("rt daemon logs -t") });
  expect(statusBlocks({ state: "boot-failed", reason: "port in use", phase: "api" } as never, 0).failure?.title).toBe("The daemon failed to start");
  for (const v of [{ state: "not-running", pid: 7 }, { state: "parked", pid: 7 }, { state: "degraded", reason: "error", pid: 7 }]) {
    expect(statusBlocks(v as never, 0).failure).toBeUndefined();
  }
});

test("not running is off, with the start command", () => {
  expect(plain({ state: "not-running", pid: 7 })).toBe("[off] The daemon is installed but not running  last pid 7\n  next: rt daemon start\n");
});

test("another flavor answering is a warning that names the app to open", () => {
  const text = renderPlain(tupleWarningBlocks({ cliFlavor: "dev", daemon: { flavor: "prod", pid: 99 } }));
  expect(text).toStartWith("[warning] A prod daemon is answering this dev rt  pid 99\n");
  expect(text).toContain("next: open ");
  expect(text).toContain("mattstack-dev.app");
  expect(text).toContain("note: Quit it first if it is running.");
  expect(tupleWarningBlocks({ cliFlavor: "dev", daemon: { flavor: "dev", pid: 1 } })).toEqual([]);
  expect(tupleWarningBlocks({ cliFlavor: "dev", daemon: null })).toEqual([]);
});

test("flavor info is a version row", () => {
  expect(renderPlain(flavorInfoBlocks({ flavor: "dev", pid: 1, version: "2.20.0", sourceRev: "abc1234" }, "dev"))).toBe("version: dev, 2.20.0, abc1234\n");
});
