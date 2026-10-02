import { afterEach, expect, mock, test } from "bun:test";
import type { PortEntry } from "../../lib/port-scanner.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

// mock.module mutates the live namespace object in place, so the real one is
// captured before any mock is installed.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realPortScanner = await import("../../lib/port-scanner.ts");
const realScan = realPortScanner.scanListeningPorts;
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

afterEach(() => {
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
  out.__test__.setHuman(() => false);
  try {
    await portScanner([]);
    expect(io.stdout()).toBe(LISTED);
    expect(io.stderr()).toBe("[warning] Scanned your ports without the rt daemon\n");
  } finally {
    io.restore();
  }
});
