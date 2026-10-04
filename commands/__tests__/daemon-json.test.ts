/**
 * rt daemon status --json and log-level --json are read by skills through
 * rt_verb; their bytes must not move.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { dirname } from "path";

import * as ui from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { DAEMON_SOCK_PATH, markDaemonInstalled, markDaemonUninstalled } from "../../lib/daemon-config.ts";
import { setLogLevel, showStatus } from "../daemon.ts";

let io: CapturedOut;
let server: ReturnType<typeof Bun.serve> | undefined;
let replies: Record<string, unknown> = {};
const realArgv = process.argv;

beforeEach(() => {
  io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  process.argv = [...realArgv, "--json"];
});

afterEach(() => {
  server?.stop(true);
  server = undefined;
  rmSync(DAEMON_SOCK_PATH, { force: true });
  markDaemonUninstalled();
  process.argv = realArgv;
  io.restore();
});

function fakeDaemon(): void {
  mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
  server = Bun.serve({
    unix: DAEMON_SOCK_PATH,
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      return Response.json(replies[cmd] ?? { ok: false, error: `unknown command: ${cmd}` });
    },
  });
}

test("status --json, not installed, is the bare not-installed envelope", async () => {
  markDaemonUninstalled();
  await showStatus(["--json"]);
  expect(io.stdout()).toBe('{"ok":true,"state":"not-installed"}\n');
  expect(io.stderr()).toBe("");
});

test("status --json, running, is the verdict spread into one line", async () => {
  markDaemonInstalled();
  replies = { status: { ok: true, data: { pid: 42, uptime: 60_000, watchedRepos: 1, cacheEntries: 2 } } };
  fakeDaemon();
  await showStatus(["--json"]);
  const line = io.stdout();
  expect(line.endsWith("\n")).toBe(true);
  expect(line.split("\n")).toHaveLength(2);
  const parsed = JSON.parse(line);
  expect(parsed.ok).toBe(true);
  expect(parsed.state).toBe("running");
  expect(parsed.data.pid).toBe(42);
  expect(line).toBe('{"ok":true,"state":"running","data":{"pid":42,"uptime":60000,"watchedRepos":1,"cacheEntries":2}}\n');
  expect(io.stderr()).toBe("");
});

test("log-level --json passes the daemon's reply through", async () => {
  replies = { "daemon:log-level": { ok: true, level: "debug" } };
  fakeDaemon();
  await setLogLevel(["debug", "--json"]);
  expect(io.stdout()).toBe('{"ok":true,"level":"debug"}\n');
  expect(io.stderr()).toBe("");
  expect(io.stdout().split("\n")).toHaveLength(2);
});
