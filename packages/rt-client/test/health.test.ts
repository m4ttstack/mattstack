import { describe, expect, test, afterEach } from "bun:test";
import { daemonHealth } from "../src/health.ts";
import { fakeDaemon } from "./fake-daemon.ts";

const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops) stop(); stops.length = 0; });

describe("daemonHealth", () => {
  test("maps an unreachable daemon to reachable:false, never a throw", async () => {
    const res = await daemonHealth({ sockPath: "/nonexistent/rt.sock" });
    expect(res).toMatchObject({ reachable: false });
    expect(res.error).toContain("unreachable");
  });

  test("a health probe reports a missing daemon at once: it does not ride the restart retry", async () => {
    const prior = process.env.RT_DAEMON_RETRY_BUDGET_MS;
    process.env.RT_DAEMON_RETRY_BUDGET_MS = "5000";
    try {
      const started = Date.now();
      const res = await daemonHealth({ sockPath: "/nonexistent/rt.sock" });
      expect(res.reachable).toBe(false);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      if (prior === undefined) delete process.env.RT_DAEMON_RETRY_BUDGET_MS;
      else process.env.RT_DAEMON_RETRY_BUDGET_MS = prior;
    }
  });

  test("maps a reachable daemon's events:head to reachable:true with no error", async () => {
    const { sock, stop } = fakeDaemon({ "events:head": { ok: true, data: { cursor: 5 } } });
    stops.push(stop);
    const res = await daemonHealth({ sockPath: sock });
    expect(res).toEqual({ reachable: true });
  });
});
