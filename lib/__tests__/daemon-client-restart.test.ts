import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { DAEMON_SOCK_PATH, RT_DIR, TRAY_SOCK_PATH, markDaemonInstalled, markDaemonUninstalled } from "../daemon-config.ts";
import { __test__, daemonQuery, daemonQueryAttributed, daemonSocketQuery, isDaemonRunning, pingDaemon } from "../daemon-client.ts";
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
      expect(attempt).toEqual({ response: null, refused: false, timedOut: false, unavailable: true });
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
