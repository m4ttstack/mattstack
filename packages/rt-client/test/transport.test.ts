import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, realpathSync } from "fs";
import { createServer } from "node:net";
import { tmpdir } from "os";
import { join } from "path";
import {
  DAEMON_DOWN_COOLOFF_MS, DAEMON_RETRY_BUDGET_MS, DAEMON_UNREACHABLE_PREFIX, __test__,
  defaultRetryBudget, isDaemonTimeout, isUnavailable, nextRetryDelay, rtCommand,
} from "../src/transport.ts";
import { fakeDaemon } from "./fake-daemon.ts";

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops) stop(); stops.length = 0; });

describe("rtCommand", () => {
  test("POSTs payload to /<cmd> and returns the daemon envelope", async () => {
    const { sock, seen, stop } = fakeDaemon({
      "project-mrs:read": { ok: true, data: { mrs: {}, listSyncedAt: 5, source: "poll", syncedAt: 5 } },
    });
    stops.push(stop);
    const res = await rtCommand("project-mrs:read", { repoName: "x" }, { sockPath: sock });
    expect(res.ok).toBe(true);
    expect(seen).toEqual([{ cmd: "project-mrs:read", payload: { repoName: "x" } }]);
  });

  test("unreachable socket returns ok:false with an instructive error, never throws", async () => {
    const sockPath = join(tmpdir(), "definitely-missing.sock");
    const res = await rtCommand("project-mrs:read", { repoName: "x" }, { sockPath });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(`rt daemon unreachable at ${sockPath}`);
  });

  test("timeout is honored: a slow daemon yields ok:false instead of hanging", async () => {
    // A dedicated slow server (not fakeDaemon, whose replies are instant) so
    // the 20ms timeout vs 200ms response delay margin is never racy.
    const sock = join(tmpdir(), `rt-client-timeout-test-${process.pid}.sock`);
    const server = Bun.serve({
      unix: sock,
      async fetch() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return Response.json({ ok: true, data: {} });
      },
    });
    stops.push(() => server.stop(true));
    const res = await rtCommand("slow-cmd", {}, { sockPath: sock, timeoutMs: 20 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(`rt daemon unreachable at ${sock}`);
    expect(res.error).toContain("slow-cmd timed out after 0.02s");
    expect(res.error).not.toContain("The operation timed out");
  });

  test("a missing socket is not worded as a timeout", async () => {
    const sockPath = join(tmpdir(), "definitely-missing.sock");
    const res = await rtCommand("project-mrs:read", { repoName: "x" }, { sockPath });
    expect(res.error).not.toContain("timed out");
    expect(isDaemonTimeout(res.error)).toBe(false);
  });

  test("isDaemonTimeout knows a timed-out call by its error", async () => {
    const sock = join(tmpdir(), `rt-client-timeout-mark-${process.pid}.sock`);
    const server = Bun.serve({ unix: sock, async fetch() { await new Promise((r) => setTimeout(r, 200)); return Response.json({ ok: true }); } });
    stops.push(() => server.stop(true));
    const res = await rtCommand("slow-cmd", {}, { sockPath: sock, timeoutMs: 20 });
    expect(isDaemonTimeout(res.error)).toBe(true);
    expect(isDaemonTimeout(undefined)).toBe(false);
  });

  test("no sockPath resolves the default at call time from process.env.HOME, not a module-load snapshot", async () => {
    const origHome = process.env.HOME;
    const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), "rt-client-transport-home-")));
    process.env.HOME = fakeHome;
    try {
      const res = await rtCommand("project-mrs:read", { repoName: "x" }, {});
      expect(res.ok).toBe(false);
      expect(res.error).toContain(join(fakeHome, ".mattstack", "rt", "rt.sock"));
    } finally {
      process.env.HOME = origHome;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  test("RT_DAEMON_SOCK env overrides the default socket path, ahead of HOME", async () => {
    const origSock = process.env.RT_DAEMON_SOCK;
    const sockPath = join(tmpdir(), `rt-client-daemon-sock-override-${process.pid}.sock`);
    process.env.RT_DAEMON_SOCK = sockPath;
    try {
      const res = await rtCommand("project-mrs:read", { repoName: "x" }, {});
      expect(res.ok).toBe(false);
      expect(res.error).toContain(`rt daemon unreachable at ${sockPath}`);
    } finally {
      if (origSock === undefined) delete process.env.RT_DAEMON_SOCK;
      else process.env.RT_DAEMON_SOCK = origSock;
    }
  });
});

describe("rtCommand: retry while the daemon restarts", () => {
  let n = 0;
  const freshSock = () => join(tmpdir(), `rtr-${process.pid}-${n++}.sock`);
  const STARTING = { ok: false, error: "rt daemon is starting; try again in a moment", unavailable: "starting" } as const;
  beforeEach(() => { __test__.resetCoolOff(); });

  /** A real socket file with no listener: bound by a child that is then killed. */
  async function staleSocket(): Promise<string> {
    const sock = freshSock();
    const child = Bun.spawn(
      ["bun", "-e", `Bun.serve({ unix: ${JSON.stringify(sock)}, fetch: () => new Response("x") }); console.log("up"); setInterval(() => {}, 1000);`],
      { stdout: "pipe", stderr: "ignore" },
    );
    await child.stdout.getReader().read();
    child.kill("SIGKILL");
    await child.exited;
    expect(existsSync(sock)).toBe(true);
    stops.push(() => rmSync(sock, { force: true }));
    return sock;
  }

  function serveLater(sock: string, afterMs: number, reply: unknown = { ok: true, data: { n: 1 } }) {
    const timer = setTimeout(() => {
      rmSync(sock, { force: true });
      const server = Bun.serve({ unix: sock, fetch: () => Response.json(reply) });
      stops.push(() => server.stop(true));
    }, afterMs);
    stops.push(() => clearTimeout(timer));
  }

  test("socket file missing, then a server appears: the call succeeds", async () => {
    const sock = freshSock();
    serveLater(sock, 300);
    const res = await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 });
    expect(res).toEqual({ ok: true, data: { n: 1 } });
  });

  test("stale socket file (no listener), then a server appears: the call succeeds", async () => {
    const sock = await staleSocket();
    serveLater(sock, 300);
    const res = await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 });
    expect(res).toEqual({ ok: true, data: { n: 1 } });
  });

  test("a starting reply is retried until the server serves", async () => {
    const sock = freshSock();
    let hits = 0;
    const server = Bun.serve({
      unix: sock,
      fetch: () => (++hits < 3 ? Response.json(STARTING, { status: 503 }) : Response.json({ ok: true, data: { n: 1 } })),
    });
    stops.push(() => server.stop(true));
    const res = await rtCommand("chat:post", {}, { sockPath: sock, retryBudgetMs: 5_000 });
    expect(res).toEqual({ ok: true, data: { n: 1 } });
    expect(hits).toBe(3);
  });

  test("a connection the server accepted and then closed is sent exactly once", async () => {
    const sock = freshSock();
    let hits = 0;
    const server = createServer((conn) => { conn.on("data", () => { hits++; conn.destroy(); }); });
    await new Promise<void>((resolve) => server.listen(sock, resolve));
    stops.push(() => server.close());
    const res = await rtCommand("chat:post", { text: "hi" }, { sockPath: sock, retryBudgetMs: 2_000 });
    expect(hits).toBe(1);
    expect(res.ok).toBe(false);
    expect(res.error!.startsWith(DAEMON_UNREACHABLE_PREFIX)).toBe(true);
  });

  test("a timeout is not retried", async () => {
    const sock = freshSock();
    let hits = 0;
    const server = Bun.serve({ unix: sock, fetch: () => { hits++; return new Promise<Response>(() => {}); } });
    stops.push(() => server.stop(true));
    const res = await rtCommand("chat:post", {}, { sockPath: sock, timeoutMs: 100, retryBudgetMs: 2_000 });
    expect(hits).toBe(1);
    expect(isDaemonTimeout(res.error)).toBe(true);
  });

  test("budget spent: the error still starts with DAEMON_UNREACHABLE_PREFIX", async () => {
    const sock = freshSock();
    const started = Date.now();
    const res = await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 300 });
    expect(res.ok).toBe(false);
    expect(res.error!.startsWith(DAEMON_UNREACHABLE_PREFIX)).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  test("after a socket has gone unanswered for the cool-off threshold, the next call returns without retrying", async () => {
    __test__.setCoolOffAfterMs(150);
    const sock = freshSock();
    await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 200 });
    const started = Date.now();
    const res = await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 });
    expect(res.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("one caller's short spent budget does not take the retry away from the next caller", async () => {
    const sock = freshSock();
    await rtCommand("pane:lookup", {}, { sockPath: sock, retryBudgetMs: 200 });
    serveLater(sock, 300);
    const res = await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 });
    expect(res).toEqual({ ok: true, data: { n: 1 } });
  });

  test("a daemon that answers starting for the whole cool-off threshold starts the cool-off", async () => {
    __test__.setCoolOffAfterMs(150);
    const sock = freshSock();
    const server = Bun.serve({ unix: sock, fetch: () => Response.json(STARTING, { status: 503 }) });
    stops.push(() => server.stop(true));
    expect(await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 200 })).toEqual(STARTING);
    const started = Date.now();
    expect(await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 })).toEqual(STARTING);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("a parked reply is returned at once and never retried", async () => {
    const sock = freshSock();
    const parked = { ok: false, error: "rt daemon is waiting for port 9401, which another process is using; run rt daemon status", parked: true };
    let hits = 0;
    const server = Bun.serve({ unix: sock, fetch: () => { hits++; return Response.json(parked, { status: 503 }); } });
    stops.push(() => server.stop(true));
    const started = Date.now();
    expect(await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 })).toEqual(parked);
    expect(hits).toBe(1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("a starting reply ends the cool-off: the daemon is back", async () => {
    __test__.setCoolOffAfterMs(150);
    const sock = freshSock();
    await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 200 });
    let hits = 0;
    const server = Bun.serve({
      unix: sock,
      fetch: () => (++hits < 3 ? Response.json(STARTING, { status: 503 }) : Response.json({ ok: true, data: { n: 1 } })),
    });
    stops.push(() => server.stop(true));
    expect(await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 })).toEqual(STARTING);
    expect(await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 })).toEqual({ ok: true, data: { n: 1 } });
  });

  test("a 2xx body that is not an object is returned, never thrown", async () => {
    const sock = freshSock();
    const server = Bun.serve({ unix: sock, fetch: () => new Response("5", { headers: { "Content-Type": "application/json" } }) });
    stops.push(() => server.stop(true));
    expect(await rtCommand("odd", {}, { sockPath: sock, retryBudgetMs: 1_000 })).toBe(5 as never);
    const nullServerSock = freshSock();
    const nullServer = Bun.serve({ unix: nullServerSock, fetch: () => new Response("null") });
    stops.push(() => nullServer.stop(true));
    expect(await rtCommand("odd", {}, { sockPath: nullServerSock, retryBudgetMs: 1_000 })).toBeNull();
  });

  test("defaultRetryBudget: 20s, except for a caller whose timeout is 5s or less", () => {
    expect(defaultRetryBudget(undefined)).toBe(20_000);
    expect(defaultRetryBudget(10_000)).toBe(20_000);
    expect(defaultRetryBudget(250_000)).toBe(20_000);
    expect(defaultRetryBudget(5_001)).toBe(20_000);
    expect(defaultRetryBudget(5_000)).toBe(5_000);
    expect(defaultRetryBudget(800)).toBe(800);
  });

  test("a spent budget as long as the cool-off threshold always starts the cool-off", async () => {
    __test__.setCoolOffAfterMs(300);
    const sock = freshSock();
    await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 300 });
    const started = Date.now();
    await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("the cool-off is per socket: another socket still gets its budget", async () => {
    __test__.setCoolOffAfterMs(150);
    await rtCommand("ping", {}, { sockPath: freshSock(), retryBudgetMs: 200 });
    const other = freshSock();
    serveLater(other, 300);
    const res = await rtCommand("ping", {}, { sockPath: other, retryBudgetMs: 5_000 });
    expect(res.ok).toBe(true);
  });

  test("a success clears the cool-off", async () => {
    __test__.setCoolOffAfterMs(150);
    const sock = freshSock();
    await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 200 });
    const server = Bun.serve({ unix: sock, fetch: () => Response.json({ ok: true }) });
    expect((await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 })).ok).toBe(true);
    server.stop(true);
    rmSync(sock, { force: true });
    serveLater(sock, 300);
    const res = await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 5_000 });
    expect(res).toEqual({ ok: true, data: { n: 1 } });
  });

  test("retryBudgetMs: 0 makes one attempt", async () => {
    const sock = freshSock();
    let hits = 0;
    const server = Bun.serve({ unix: sock, fetch: () => { hits++; return Response.json(STARTING, { status: 503 }); } });
    stops.push(() => server.stop(true));
    const res = await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 0 });
    expect(hits).toBe(1);
    expect(res).toEqual(STARTING);
  });

  test("an unavailable reply after the budget is returned as the daemon sent it", async () => {
    const sock = freshSock();
    const server = Bun.serve({ unix: sock, fetch: () => Response.json(STARTING, { status: 503 }) });
    stops.push(() => server.stop(true));
    const res = await rtCommand("ping", {}, { sockPath: sock, retryBudgetMs: 300 });
    expect(res).toEqual({ ok: false, error: "rt daemon is starting; try again in a moment", unavailable: "starting" });
  });

  test("a caller's short timeoutMs also bounds the retry", async () => {
    const sock = freshSock();
    const prior = process.env.RT_DAEMON_RETRY_BUDGET_MS;
    delete process.env.RT_DAEMON_RETRY_BUDGET_MS;
    try {
      const started = Date.now();
      const res = await rtCommand("ping", {}, { sockPath: sock, timeoutMs: 300 });
      expect(res.ok).toBe(false);
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      if (prior !== undefined) process.env.RT_DAEMON_RETRY_BUDGET_MS = prior;
    }
  });

  test("RT_DAEMON_RETRY_BUDGET_MS=0 turns retrying off for a call that names no budget", async () => {
    const sock = freshSock();
    const prior = process.env.RT_DAEMON_RETRY_BUDGET_MS;
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "0";
    try {
      const started = Date.now();
      const res = await rtCommand("ping", {}, { sockPath: sock });
      expect(res.ok).toBe(false);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      if (prior === undefined) delete process.env.RT_DAEMON_RETRY_BUDGET_MS;
      else process.env.RT_DAEMON_RETRY_BUDGET_MS = prior;
    }
  });

  test("the test preload turns retrying off, so a missing daemon fails fast in tests", () => {
    expect(process.env.RT_DAEMON_RETRY_BUDGET_MS).toBe("0");
  });

  test("nextRetryDelay: 100, 200, 400, 800, 1000, 1000", () => {
    expect([0, 1, 2, 3, 4, 5].map(nextRetryDelay)).toEqual([100, 200, 400, 800, 1000, 1000]);
  });

  test("isUnavailable knows the daemon's 503 body and nothing else", () => {
    expect(isUnavailable(STARTING)).toBe(true);
    expect(isUnavailable({ ok: false, error: "x", unavailable: "stopping" })).toBe(true);
    expect(isUnavailable({ ok: false, error: "x" })).toBe(false);
    expect(isUnavailable({ ok: true, unavailable: "starting" })).toBe(false);
    expect(isUnavailable(null)).toBe(false);
  });

  test("the budget is 20 seconds and the cool-off 30", () => {
    expect(DAEMON_RETRY_BUDGET_MS).toBe(20_000);
    expect(DAEMON_DOWN_COOLOFF_MS).toBe(30_000);
  });
});

describe("RT_TEST_FORBID_SOCKS guard", () => {
  const origForbid = process.env.RT_TEST_FORBID_SOCKS;
  const origSock = process.env.RT_DAEMON_SOCK;
  afterEach(() => {
    if (origForbid === undefined) delete process.env.RT_TEST_FORBID_SOCKS;
    else process.env.RT_TEST_FORBID_SOCKS = origForbid;
    if (origSock === undefined) delete process.env.RT_DAEMON_SOCK;
    else process.env.RT_DAEMON_SOCK = origSock;
  });

  test("an explicit sockPath on the forbidden list throws instead of degrading", async () => {
    const forbidden = join(tmpdir(), `rt-client-forbidden-${process.pid}.sock`);
    process.env.RT_TEST_FORBID_SOCKS = JSON.stringify([forbidden]);
    await expect(rtCommand("chat:post", {}, { sockPath: forbidden })).rejects.toThrow(/forbidden/);
  });

  test("a forbidden socket reached via RT_DAEMON_SOCK resolution throws too", async () => {
    const forbidden = join(tmpdir(), `rt-client-forbidden-env-${process.pid}.sock`);
    process.env.RT_TEST_FORBID_SOCKS = JSON.stringify([forbidden]);
    process.env.RT_DAEMON_SOCK = forbidden;
    await expect(rtCommand("chat:post", {}, {})).rejects.toThrow(/forbidden/);
  });

  test("a socket not on the list keeps the degrade-to-envelope contract", async () => {
    process.env.RT_TEST_FORBID_SOCKS = JSON.stringify(["/somewhere/else.sock"]);
    const sockPath = join(tmpdir(), "definitely-missing.sock");
    const res = await rtCommand("chat:post", {}, { sockPath });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("unreachable");
  });

  test("a malformed forbidden list throws rather than silently disarming the guard", async () => {
    process.env.RT_TEST_FORBID_SOCKS = "not json";
    const sockPath = join(tmpdir(), "definitely-missing.sock");
    await expect(rtCommand("chat:post", {}, { sockPath })).rejects.toThrow();
  });

  test("valid JSON that is not a string array throws too: a JSON string has .includes()", async () => {
    process.env.RT_TEST_FORBID_SOCKS = JSON.stringify("/somewhere/else.sock");
    const sockPath = join(tmpdir(), "definitely-missing.sock");
    await expect(rtCommand("chat:post", {}, { sockPath })).rejects.toThrow(/string array/);
  });
});
