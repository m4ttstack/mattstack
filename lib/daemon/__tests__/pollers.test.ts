import { afterEach, expect, spyOn, test } from "bun:test";
import type { PortEntry } from "../../port-scanner.ts";
import type { PortCacheRef, RepoIndex } from "../handlers/types.ts";
import { startPollers, type PollerDeps, type PollersHandle } from "../pollers.ts";

const quietLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as PollerDeps["log"];

let handle: PollersHandle | null = null;
afterEach(() => {
  handle?.stop();
  handle = null;
});

function poller(overrides: Partial<PollerDeps> = {}): PollersHandle {
  const portCacheRef: PortCacheRef = { ports: [], updatedAt: 0 };
  const repoIndex: () => RepoIndex = () => ({});
  handle = startPollers({
    log: quietLog,
    refreshCache: async () => {},
    portCacheRef,
    broadcast: () => {},
    repoIndex,
    checkAndRepairHooksPath: async () => true,
    demanded: () => true,
    scanPorts: async () => [],
    ...overrides,
  });
  return handle;
}

test("a second port-scan tick during an in-flight scan does not double-run it", async () => {
  let calls = 0;
  let resolveScan!: (v: PortEntry[]) => void;
  const scanPorts = () => {
    calls++;
    return new Promise<PortEntry[]>((r) => { resolveScan = r; });
  };
  const h = poller({ scanPorts });

  const first = h.tickPorts();
  const second = h.tickPorts(); // fires while the first scan is still in flight
  expect(calls).toBe(1); // the second tick did not start a new scan

  resolveScan([]);
  await Promise.all([first, second]);
});

test("demand gating skips the port scan when nothing is demanded, then runs once demand resumes", async () => {
  let calls = 0;
  let demand = false;
  const h = poller({
    scanPorts: async () => { calls++; return []; },
    demanded: () => demand,
  });

  await h.tickPorts();
  expect(calls).toBe(0); // no consumer asked recently -> the scanner is not invoked

  demand = true;
  await h.tickPorts();
  expect(calls).toBe(1);
});

test("a never-settling port scan is abandoned via the deadline so a later tick can run", async () => {
  let calls = 0;
  const scanPorts = () => {
    calls++;
    return calls === 1
      ? new Promise<PortEntry[]>(() => {}) // never settles
      : Promise.resolve([]);
  };
  const h = poller({ scanPorts, scanDeadlineMs: 20 });

  const t0 = Date.now();
  await h.tickPorts(); // the hung scan never resolves; the deadline race does
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(calls).toBe(1);

  await h.tickPorts(); // latch cleared by the deadline -> a later tick runs
  expect(calls).toBe(2);
});

test("arms no background process scan: only the cache, port and hooks intervals run", () => {
  const delays: number[] = [];
  const spy = spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    return 0 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval);
  try {
    const h = poller();
    expect(delays.sort((a, b) => a - b)).toEqual([30_000, 60_000, 5 * 60_000]);
    expect("tickProcesses" in h).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

test("a port scan refused at the orphan cap is logged, not silent", async () => {
  const warns: unknown[][] = [];
  const recordingLog = {
    debug: () => {}, info: () => {}, error: () => {},
    warn: (...a: unknown[]) => { warns.push(a); },
  } as unknown as PollerDeps["log"];
  const h = poller({
    log: recordingLog,
    scanPorts: () => new Promise<PortEntry[]>(() => {}), // hangs -> every scan orphans
    scanDeadlineMs: 20,
  });

  await h.tickPorts(); // orphan 1
  await h.tickPorts(); // orphan 2
  await h.tickPorts(); // cap hit -> refused
  await new Promise((r) => setTimeout(r, 10));

  expect(warns.some((w) => String(w[0] ?? "").includes("too many stalled"))).toBe(true);
});
