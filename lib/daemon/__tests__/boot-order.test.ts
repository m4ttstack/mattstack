import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, test, expect } from "bun:test";
import type { Server } from "bun";
import { buildUnits, makeBootContext } from "../../daemon.ts";
import { runUnits, stopUnits } from "../lifecycle.ts";
import { closeStateDb } from "../../state/db.ts";
import { DAEMON_PID_PATH, DAEMON_SOCK_PATH, RT_DIR } from "../../daemon-config.ts";

// The unit list records boot attempts / ready stamps into state.db and writes
// supervision breadcrumbs, so this case runs under its own HOME to keep those
// writes out of the shared per-process test tree (state.db resolves HOME at
// call time). The singleton is closed on both sides so this run owns the open
// and the next test re-derives against the restored HOME.
let priorHome: string | undefined;
let priorPath: string | undefined;
beforeEach(() => {
  priorHome = process.env.HOME;
  priorPath = process.env.PATH;
  process.env.HOME = mkdtempSync(join(tmpdir(), "rt-boot-order-"));
  closeStateDb();
});
afterEach(() => {
  closeStateDb();
  if (priorHome !== undefined) process.env.HOME = priorHome;
  if (priorPath !== undefined) process.env.PATH = priorPath; // unit 3 prepends to PATH
});

// The authoritative boot order (spec §5.1 "Boot order"). The test owns this
// list so a reordering of buildUnits fails here rather than silently shipping.
const EXPECTED_ORDER = [
  "logger",
  "park-gate",
  "socket-server",
  "rt-pid",
  "path-resolution",
  "events-db",
  "state-db",
  "background-subsystems",
  "handlers",
  "api-server",
  "socket-ready",
  "pollers",
  "ready",
  "socket-drain",
] as const;

const fakeServer = (): Server<any> => ({ stop() {} }) as unknown as Server<any>;

test("units start in spec order, pid right after the socket bind, state.db busy_timeout set, reverse stop closes state.db", async () => {
  const spy: string[] = [];
  let stateClosed = 0;

  const ctx = makeBootContext({
    redirectNativeStderr: () => {},
    parkGate: async () => {},
    resolveUserPath: async () => "",
    installCrashHandlers: () => {},
    installSignalHandlers: () => {},
    bindApiServer: async () => { spy.push("api-bound"); return fakeServer(); },
    evictStaleDaemon: async () => { spy.push("evicted"); },
    bindSocketServer: (_h, _l, availability) => { spy.push(`socket-bound:${availability.state}`); return fakeServer(); },
    writePid: () => { spy.push("pid-written"); },
    closeStateDb: () => { spy.push("closeStateDb"); stateClosed++; closeStateDb(); },
  });
  ctx.spy = spy;

  const units = buildUnits(ctx);
  expect(units.map((u) => u.name)).toEqual([...EXPECTED_ORDER]);

  // Wrap each unit so start/stop order is recorded in the same spy stream the
  // seams write to, giving one ordered sequence to assert pid/close against.
  const spied = units.map((u) => ({
    name: u.name,
    start: async () => { spy.push(`start:${u.name}`); await u.start(); },
    stop: async () => { spy.push(`stop:${u.name}`); await u.stop(); },
  }));

  await runUnits(spied, ctx.log);

  // (a) start order matches the 12-entry list.
  const starts = spy.filter((e) => e.startsWith("start:")).map((e) => e.slice("start:".length));
  expect(starts).toEqual([...EXPECTED_ORDER]);

  // (b) a stale daemon is evicted before the bind, the socket binds in the
  // starting state, rt.pid follows the bind, and serving starts only once
  // the handlers exist and the API server is bound.
  expect(spy.indexOf("evicted")).toBeGreaterThan(-1);
  expect(spy.indexOf("evicted")).toBeLessThan(spy.indexOf("socket-bound:starting"));
  expect(spy.indexOf("pid-written")).toBeGreaterThan(spy.indexOf("socket-bound:starting"));
  expect(spy.indexOf("pid-written")).toBeLessThan(spy.indexOf("start:path-resolution"));
  expect(spy.indexOf("socket-bound:starting")).toBeLessThan(spy.indexOf("start:events-db"));
  expect(ctx.availability.state).toBe("serving");
  expect(spy.indexOf("start:socket-ready")).toBeGreaterThan(spy.indexOf("api-bound"));
  expect(spy.indexOf("start:socket-ready")).toBeGreaterThan(spy.indexOf("start:handlers"));

  // (c) state.db opened at the daemon's contention policy (busy_timeout 250ms).
  const bt = (ctx.stateDb!.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout;
  expect(bt).toBe(250);

  await stopUnits(spied, ctx.log);

  // (d) clean stop runs in reverse and closeStateDb() ran during it.
  const stops = spy.filter((e) => e.startsWith("stop:")).map((e) => e.slice("stop:".length));
  expect(stops).toEqual([...EXPECTED_ORDER].reverse());
  expect(stateClosed).toBeGreaterThan(0);
  expect(spy.indexOf("closeStateDb")).toBeGreaterThan(spy.indexOf("stop:ready"));
  // (e) the drain ran first, so the socket stopped serving while the stores were still open.
  expect(stops[0]).toBe("socket-drain");
  expect(ctx.availability.state).toBe("stopping");
});

test("the socket answers starting until the socket-ready unit runs", async () => {
  const states: string[] = [];
  const ctx = makeBootContext({
    redirectNativeStderr: () => {},
    parkGate: async () => {},
    resolveUserPath: async () => "",
    installCrashHandlers: () => {},
    installSignalHandlers: () => {},
    evictStaleDaemon: async () => {},
    bindApiServer: async () => fakeServer(),
    bindSocketServer: () => fakeServer(),
    writePid: () => {},
  });
  const units = buildUnits(ctx).map((u) => ({
    name: u.name,
    start: async () => { await u.start(); states.push(`${u.name}:${ctx.availability.state}`); },
    stop: () => u.stop(),
  }));
  await runUnits(units, ctx.log);
  expect(states).toContain("handlers:starting");
  expect(states).toContain("api-server:starting");
  expect(states).toContain("socket-ready:serving");
  await stopUnits(units, ctx.log);
});

test("a boot that fails after the bind leaves neither rt.pid nor rt.sock behind", async () => {
  const ctx = makeBootContext({
    redirectNativeStderr: () => {},
    parkGate: async () => {},
    resolveUserPath: async () => { throw new Error("path scrape failed"); },
    installCrashHandlers: () => {},
    installSignalHandlers: () => {},
    evictStaleDaemon: async () => {},
    bindApiServer: async () => fakeServer(),
    bindSocketServer: () => {
      mkdirSync(RT_DIR, { recursive: true });
      writeFileSync(DAEMON_SOCK_PATH, "");
      return fakeServer();
    },
  });
  const units = buildUnits(ctx);
  await expect(runUnits(units, ctx.log)).rejects.toThrow("path scrape failed");
  expect(existsSync(DAEMON_PID_PATH)).toBe(false);
  expect(existsSync(DAEMON_SOCK_PATH)).toBe(false);
});
