import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { PortEntry } from "../../lib/port-scanner.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";

// mock.module mutates the live namespace object in place, so the real one is
// captured before any mock is installed.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realPortScanner = await import("../../lib/port-scanner.ts");
const realScan = realPortScanner.scanListeningPorts;
const realPickWrappers = await import("../../lib/pick-wrappers.ts");
const realMultiselect = realPickWrappers.filterableMultiselect;
const { portBlocks, portScanner, __test__ } = await import("../port.ts");

function fakeDaemon(ports: PortEntry[]): void {
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    daemonQuery: async () => ({ ok: true, data: { ports } }),
  }));
}

/** No daemon reply at all, and a direct scan that finds `ports` without running lsof. */
function noDaemon(ports: PortEntry[]): void {
  mock.module("../../lib/daemon-client.ts", () => ({ ...realDaemonClient, daemonQuery: async () => null }));
  mock.module("../../lib/port-scanner.ts", () => ({ ...realPortScanner, scanListeningPorts: async () => ports }));
}

let savedTTY: boolean | undefined;
const setTTY = (value: boolean | undefined): void => {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
};

beforeEach(() => {
  savedTTY = process.stdin.isTTY;
  setTTY(false);
});

afterEach(() => {
  setTTY(savedTTY);
  mock.module("../../lib/daemon-client.ts", () => ({ ...realDaemonClient, daemonQuery: realDaemonQuery }));
  mock.module("../../lib/port-scanner.ts", () => ({ ...realPortScanner, scanListeningPorts: realScan }));
});

const entry = (over: Partial<PortEntry>): PortEntry => ({
  port: 3000,
  pid: 101,
  command: "node",
  cwd: "/code/sample-app",
  repo: "sample-app",
  worktree: "/code/sample-app",
  branch: "feature/login",
  relativeDir: ".",
  uptime: "05:12",
  ...over,
});

const ENTRIES: PortEntry[] = [
  entry({ relativeDir: "apps/web" }),
  entry({ port: 5432, pid: 102, command: "postgres", uptime: "01:02:03" }),
  entry({ port: 8080, pid: 103, command: "bun", repo: "other-tool", worktree: "/code/other", branch: null, uptime: "00:09" }),
];

const row = (cells: string[], widths: number[]): string => "  - " + cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ");

const LISTED =
  "sample-app\n" +
  "feature/login\n" +
  row([":3000", "sample-app/apps/web", "node", "5m"], [5, 19, 8]) + "\n" +
  row([":5432", "sample-app", "postgres", "1h2m"], [5, 19, 8]) + "\n" +
  "\n" +
  "other-tool\n" +
  "other\n" +
  "  - :8080  other  bun  09s\n";

test("ports are grouped by repo, then by branch, one row per port", () => {
  expect(renderPlain(portBlocks(ENTRIES))).toBe(LISTED);
});

test("no ports is one done line", () => {
  expect(renderPlain(portBlocks([]))).toBe("[ok] Nothing is listening in your repos\n");
});

test("uptime reads as the largest unit that fits", () => {
  expect(__test__.formatUptime("05:12")).toBe("5m");
  expect(__test__.formatUptime("00:09")).toBe("09s");
  expect(__test__.formatUptime("01:02:03")).toBe("1h2m");
  expect(__test__.formatUptime("2-01:02:03")).toBe("2d");
  expect(__test__.formatUptime("")).toBe("?");
});

test("off a terminal rt port prints the list once, on stdout, with no scan line", async () => {
  fakeDaemon(ENTRIES);
  const io = captureOut();
  io.reset();
  out.__test__.setHuman(() => false);
  try {
    await portScanner([]);
    expect(io.stdout()).toBe(LISTED);
    expect(io.stderr()).toBe("");
  } finally {
    io.restore();
  }
});

test("rt port kill off a terminal lists instead of opening a picker", async () => {
  fakeDaemon(ENTRIES);
  const io = captureOut();
  io.reset();
  out.__test__.setHuman(() => false);
  try {
    await portScanner(["kill"]);
    expect(io.stdout()).toBe(LISTED);
    expect(io.stderr()).toBe("");
  } finally {
    io.restore();
  }
});

test("rt port kill with no ports is the one done line", async () => {
  fakeDaemon([]);
  const io = captureOut();
  io.reset();
  out.__test__.setHuman(() => false);
  try {
    await portScanner(["kill"]);
    expect(io.stdout()).toBe("[ok] Nothing is listening in your repos\n");
  } finally {
    io.restore();
  }
});

test("when the daemon does not answer, rt port scans by itself and says so on stderr", async () => {
  noDaemon(ENTRIES);
  const io = captureOut();
  io.reset();
  out.__test__.setHuman(() => false);
  try {
    await portScanner([]);
    expect(io.stdout()).toBe(LISTED);
    expect(io.stderr()).toBe("[warning] Scanned your ports without the rt daemon\n");
  } finally {
    io.restore();
  }
});

describe("stopping what listens on a port", () => {
  const LSOF =
    "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n" +
    "node      101 me     23u  IPv4 0x1         0t0  TCP *:3000 (LISTEN)\n" +
    "node      101 me     24u  IPv6 0x2         0t0  TCP *:3000 (LISTEN)\n" +
    "postgres  102 root    5u  IPv4 0x3         0t0  TCP *:3000 (LISTEN)\n" +
    "bun       103 me      7u  IPv4 0x4         0t0  TCP *:3000 (LISTEN)\n" +
    "ruby      104 me      9u  IPv4 0x5         0t0  TCP *:3000 (LISTEN)\n";
  const errno = (code: string, message = `kill ${code}`): Error => Object.assign(new Error(message), { code });
  const OUTCOMES: Record<number, Error | undefined> = { 102: errno("EPERM"), 103: errno("ESRCH"), 104: errno("EINVAL", "invalid signal") };
  let killed: number[];
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    killed = [];
    __test__.setSystem({
      listeners: () => LSOF,
      kill: (pid) => {
        killed.push(pid);
        const err = OUTCOMES[pid];
        if (err) throw err;
      },
    });
    io = captureOut();
    io.reset();
    out.__test__.setHuman(() => false);
  });
  afterEach(() => {
    io.restore();
    __test__.setSystem(undefined);
    gate.setInteractive(undefined);
    mock.module("../../lib/pick-wrappers.ts", () => ({ ...realPickWrappers, filterableMultiselect: realMultiselect }));
  });

  test("rt port <n> names each process by its command and says why one could not stop", async () => {
    await portScanner(["3000"]);
    expect(killed).toEqual([101, 102, 103, 104]);
    expect(io.stdout()).toBe("[ok] Stopped node  pid 101, port 3000\n[skipped] bun had already stopped  pid 103, port 3000\n");
    expect(io.stderr()).toBe(
      "Could not stop postgres  pid 102, port 3000\n" +
        "  why: It belongs to another user or to macOS.\n" +
        "[failed] Could not stop ruby  pid 104, port 3000\n" +
        "  why: invalid signal\n",
    );
    expect(process.exitCode).toBeFalsy();
  });

  test("rt port kill <n> takes the same path", async () => {
    __test__.setSystem({ listeners: () => LSOF.split("\n").slice(0, 2).join("\n") + "\n", kill: (pid) => void killed.push(pid) });
    await portScanner(["kill", "3000"]);
    expect(io.stdout()).toBe("[ok] Stopped node  pid 101, port 3000\n");
    expect(io.stderr()).toBe("");
  });

  test("a port nothing listens on is one skipped line and no kill", async () => {
    __test__.setSystem({ listeners: () => "", kill: (pid) => void killed.push(pid) });
    await portScanner(["3000"]);
    expect(killed).toEqual([]);
    expect(io.stdout()).toBe("[skipped] Nothing is listening on port 3000\n");
  });

  test("a pid that is not a real process id is never signalled, from the picker or from lsof", async () => {
    fakeDaemon([entry({ pid: 0, command: "ghost" }), entry({ port: 4000, pid: -1, command: "phantom" })]);
    setTTY(true);
    gate.setInteractive(() => false);
    mock.module("../../lib/pick-wrappers.ts", () => ({ ...realPickWrappers, filterableMultiselect: async () => ["0", "-1"] }));
    __test__.setSystem({ listeners: () => "", kill: (pid) => void killed.push(pid) });
    await portScanner([]);
    expect(killed).toEqual([]);
    expect(io.stdout()).toBe("[skipped] ghost has no process to stop  port 3000\n[skipped] phantom has no process to stop  port 4000\n");

    io.clear();
    __test__.setSystem({ listeners: () => LSOF.split("\n")[0] + "\nghost       0 me     3u  IPv4 0x9  0t0  TCP *:3000 (LISTEN)\n", kill: (pid) => void killed.push(pid) });
    await portScanner(["3000"]);
    expect(killed).toEqual([]);
    expect(io.stdout()).toBe("[skipped] ghost has no process to stop  port 3000\n");
    expect(io.stderr()).toBe("");
  });

  test("a NaN pid omits the pid hint and is never signalled", async () => {
    fakeDaemon([entry({ pid: Number.NaN })]);
    setTTY(true);
    gate.setInteractive(() => false);
    mock.module("../../lib/pick-wrappers.ts", () => ({ ...realPickWrappers, filterableMultiselect: async () => ["NaN"] }));
    await portScanner([]);
    expect(killed).toEqual([]);
    expect(io.stdout()).toBe("[skipped] node has no process to stop  port 3000\n");
    expect(io.stderr()).toBe("");
  });

  test("the picker stops what was picked and reads the same way", async () => {
    fakeDaemon(ENTRIES);
    setTTY(true);
    gate.setInteractive(() => false);
    mock.module("../../lib/pick-wrappers.ts", () => ({ ...realPickWrappers, filterableMultiselect: async () => ["101", "102"] }));
    __test__.setSystem({
      listeners: () => {
        throw new Error("the picker path never runs lsof");
      },
      kill: (pid) => {
        killed.push(pid);
        if (pid === 102) throw errno("ESRCH");
      },
    });
    await portScanner([]);
    expect(killed).toEqual([101, 102]);
    expect(io.stdout()).toBe("[ok] Stopped node  pid 101, port 3000\n[skipped] postgres had already stopped  pid 102, port 5432\n");
    expect(io.stderr()).toBe("");
  });
});
