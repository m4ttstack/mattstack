import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { createServer } from "node:net";
import { DAEMON_SOCK_PATH, RT_DIR, TRAY_SOCK_PATH, markDaemonInstalled, markDaemonUninstalled } from "../daemon-config.ts";
import { __test__, daemonPresence, daemonQuery, daemonQueryAttributed, isDaemonServing, daemonSocketQuery, isDaemonRunning, pingDaemon } from "../daemon-client.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const STARTING = { ok: false, error: "rt daemon is starting; try again in a moment", unavailable: "starting" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("daemon-client: a daemon that is starting or stopping", () => {
  const priorBudget = process.env.RT_DAEMON_RETRY_BUDGET_MS;
  let daemon: ReturnType<typeof Bun.serve> | undefined;
  let tray: ReturnType<typeof Bun.serve> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let trayStartCalls = 0;

  function fakeTray(reply: unknown = { ok: true }) {
    tray = Bun.serve({ unix: TRAY_SOCK_PATH, fetch: () => { trayStartCalls++; return json(reply); } });
  }

  beforeEach(() => {
    mkdirSync(RT_DIR, { recursive: true });
    markDaemonInstalled();
    trayStartCalls = 0;
    __test__.resetDownWarning();
  });

  afterEach(() => {
    if (timer) clearTimeout(timer);
    daemon?.stop(true);
    tray?.stop(true);
    daemon = tray = timer = undefined;
    rmSync(DAEMON_SOCK_PATH, { force: true });
    rmSync(TRAY_SOCK_PATH, { force: true });
    markDaemonUninstalled();
    if (priorBudget === undefined) delete process.env.RT_DAEMON_RETRY_BUDGET_MS;
    else process.env.RT_DAEMON_RETRY_BUDGET_MS = priorBudget;
  });

  test("an unavailable reply reads as no response to the single-attempt probes", async () => {
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => json(STARTING, 503) });
    expect(await daemonSocketQuery("ping")).toBeNull();
    expect(await pingDaemon()).toBeNull();
  });

  test("isDaemonRunning is false for a starting daemon", async () => {
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => json(STARTING, 503) });
    expect(await isDaemonRunning()).toBe(false);
  });

  test("daemonQueryAttributed retries an unavailable reply and returns the real answer", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "5000";
    let hits = 0;
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => (++hits < 3 ? json(STARTING, 503) : json({ ok: true })) });
    const attempt = await daemonQueryAttributed("status");
    expect(attempt.response).toEqual({ ok: true });
    expect(attempt.unavailable).toBe(false);
    expect(hits).toBe(3);
  });

  test("an unavailable daemon past the budget returns response null without asking the tray to start one, and without the down warning", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "300";
    fakeTray();
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => json(STARTING, 503) });
    const cap = captureOut();
    try {
      const attempt = await daemonQueryAttributed("status");
      expect(attempt).toEqual({ response: null, refused: false, timedOut: false, connectFailed: false, unavailable: true, unavailableState: "starting" });
      expect(trayStartCalls).toBe(0);
      expect(cap.stderr()).toBe("");
    } finally {
      cap.restore();
    }
  });

  test("with no retry budget an unavailable reply is one attempt", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "0";
    let hits = 0;
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => { hits++; return json(STARTING, 503); } });
    const attempt = await daemonQueryAttributed("status");
    expect(attempt.response).toBeNull();
    expect(hits).toBe(1);
  });

  test("a caller that asks for no retry gets one attempt at a starting daemon, whatever the default budget", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "5000";
    let hits = 0;
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => { hits++; return json(STARTING, 503); } });
    const started = Date.now();
    expect(await daemonQuery("status", undefined, undefined, { retryBudgetMs: 0 })).toBeNull();
    expect(hits).toBe(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("after the tray acks a start, the wait for the socket runs up to the retry budget", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "8000";
    fakeTray();
    // Past the 3s wait this replaced.
    timer = setTimeout(() => { daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => json({ ok: true, data: 7 }) }); }, 3_600);
    const attempt = await daemonQueryAttributed("status", {}, 500);
    expect(attempt.response).toEqual({ ok: true, data: 7 });
    expect(trayStartCalls).toBe(1);
  }, 12_000);

  test("after the tray acks a start, a daemon that answers starting first is waited for", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "5000";
    fakeTray();
    let serving = false;
    timer = setTimeout(() => {
      daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => (serving ? json({ ok: true, data: 7 }) : json(STARTING, 503)) });
      timer = setTimeout(() => { serving = true; }, 500);
    }, 200);
    const attempt = await daemonQueryAttributed("status", {}, 500);
    expect(attempt.response).toEqual({ ok: true, data: 7 });
  }, 10_000);

  test("a request the daemon accepted and dropped is sent once, even when rt.sock is gone afterwards", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "3000";
    fakeTray();
    let hits = 0;
    const dropper = createServer((conn) => {
      conn.on("data", () => {
        hits++;
        rmSync(DAEMON_SOCK_PATH, { force: true });
        conn.destroy();
      });
    });
    await new Promise<void>((resolve) => dropper.listen(DAEMON_SOCK_PATH, resolve));
    try {
      const attempt = await daemonQueryAttributed("mr:action", { action: "merge" }, 1_000);
      expect(attempt.response).toBeNull();
      expect(hits).toBe(1);
      expect(trayStartCalls).toBe(0);
    } finally {
      dropper.close();
    }
  });

  test("a query that timed out is not sent again when rt.sock is gone afterwards", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "3000";
    fakeTray();
    let hits = 0;
    daemon = Bun.serve({
      unix: DAEMON_SOCK_PATH,
      fetch: () => { hits++; rmSync(DAEMON_SOCK_PATH, { force: true }); return new Promise<Response>(() => {}); },
    });
    const attempt = await daemonQueryAttributed("mr:action", { action: "merge" }, 150);
    expect(attempt.timedOut).toBe(true);
    expect(hits).toBe(1);
    expect(trayStartCalls).toBe(0);
  });

  test("a socket that is missing when the query is sent still asks the tray for a start", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "0";
    fakeTray({ ok: false });
    const cap = captureOut();
    try {
      const attempt = await daemonQueryAttributed("status");
      expect(attempt.response).toBeNull();
      expect(trayStartCalls).toBe(1);
    } finally {
      cap.restore();
    }
  });

  test("a socket missing for a moment is waited for before the tray is asked for a start", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "5000";
    fakeTray();
    timer = setTimeout(() => { daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => json({ ok: true, data: 7 }) }); }, 500);
    const attempt = await daemonQueryAttributed("status", {}, 500);
    expect(attempt.response).toEqual({ ok: true, data: 7 });
    expect(trayStartCalls).toBe(0);
  });

  test("a caller that asks for no retry does not wait out the default budget after a tray-acked start", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "9000";
    fakeTray();
    const cap = captureOut();
    try {
      const started = Date.now();
      expect(await daemonQuery("status", undefined, 300, { retryBudgetMs: 0 })).toBeNull();
      expect(Date.now() - started).toBeLessThan(6_000);
      expect(trayStartCalls).toBe(1);
    } finally {
      cap.restore();
    }
  }, 12_000);

  test("daemonPresence tells a serving, starting, stopping and parked daemon and no daemon apart", async () => {
    expect(await daemonPresence()).toBe("absent");
    let reply: unknown = STARTING;
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => (reply === null ? json({ ok: true }) : json(reply, 503)) });
    expect(await daemonPresence()).toBe("starting");
    reply = { ok: false, error: "rt daemon is restarting; try again in a moment", unavailable: "stopping" };
    expect(await daemonPresence()).toBe("stopping");
    reply = { ok: false, error: "rt daemon is waiting for port 9401, which another process is using; see rt daemon logs", parked: true };
    expect(await daemonPresence()).toBe("parked");
    reply = null;
    expect(await daemonPresence()).toBe("serving");
  });

  test("isDaemonServing waits through a starting daemon, never asks the tray, and is false when nothing is there", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "5000";
    fakeTray();
    let hits = 0;
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => (++hits < 3 ? json(STARTING, 503) : json({ ok: true })) });
    expect(await isDaemonServing()).toBe(true);
    daemon.stop(true);
    daemon = undefined;
    rmSync(DAEMON_SOCK_PATH, { force: true });
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "0";
    expect(await isDaemonServing()).toBe(false);
    expect(trayStartCalls).toBe(0);
  });

  test("isDaemonServing rides through the gap where the socket is missing", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "5000";
    timer = setTimeout(() => { daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => json({ ok: true }) }); }, 500);
    expect(await isDaemonServing()).toBe(true);
  });

  test("a timed-out query is not retried", async () => {
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "5000";
    let hits = 0;
    daemon = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => { hits++; return new Promise<Response>(() => {}); } });
    const attempt = await daemonQueryAttributed("mr:action", { x: 1 }, 150);
    expect(hits).toBe(1);
    expect(attempt.timedOut).toBe(true);
    expect(attempt.response).toBeNull();
  });
});
