import { describe, test, expect } from "bun:test";
import { mkdirSync } from "fs";
import type { Server } from "bun";
import { startSocketServer } from "../socket-server.ts";
import { DAEMON_SOCK_PATH, RT_DIR } from "../../daemon-config.ts";
import { GATE_REQUEST_LIMIT_BYTES, MAX_REQUEST_BODY_SIZE } from "../request-limits.ts";
import { createSocketAvailability, type SocketAvailability } from "../socket-availability.ts";
import { probeSocketHolder } from "../park.ts";

type HandleCommand = (cmd: string, payload: any, signal?: AbortSignal) => Promise<any>;

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

/**
 * Starts a real unix-socket server (RT_DIR is under the isolated per-test
 * HOME from test-setup.ts, so this never touches a real daemon's socket)
 * with the given fake handleCommand, runs `run`, and always stops the
 * server afterward, even when an assertion inside `run` throws.
 */
async function withSocketServer(
  handleCommand: HandleCommand,
  run: () => Promise<void>,
  availability?: SocketAvailability,
): Promise<void> {
  mkdirSync(RT_DIR, { recursive: true });
  let server: Server<any> | undefined;
  try {
    server = startSocketServer({ handleCommand, log: noopLog, availability });
    await run();
  } finally {
    server?.stop(true);
  }
}

describe("startSocketServer: dispatch", () => {
  test("a request reaches handleCommand with the pathname-derived command and the framed response comes back", async () => {
    const calls: Array<{ cmd: string; payload: any }> = [];
    const handleCommand: HandleCommand = async (cmd, payload) => {
      calls.push({ cmd, payload });
      return { ok: true, data: "repos-list" };
    };
    await withSocketServer(handleCommand, async () => {
      const res = await fetch("http://localhost/repos", { unix: DAEMON_SOCK_PATH });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, data: "repos-list" });
      expect(calls).toEqual([{ cmd: "repos", payload: {} }]);
    });
  });

  test("a POST body is parsed as JSON and dispatched as the payload", async () => {
    const calls: Array<{ cmd: string; payload: any }> = [];
    const handleCommand: HandleCommand = async (cmd, payload) => {
      calls.push({ cmd, payload });
      return { ok: true };
    };
    await withSocketServer(handleCommand, async () => {
      const res = await fetch("http://localhost/cache:refresh", {
        unix: DAEMON_SOCK_PATH,
        method: "POST",
        body: JSON.stringify({ branch: "main" }),
      });
      expect(res.status).toBe(200);
      expect(calls).toEqual([{ cmd: "cache:refresh", payload: { branch: "main" } }]);
    });
  });
});

describe("startSocketServer: failure envelope (R035)", () => {
  test("a thrown handler returns 500 with the additive failure envelope", async () => {
    const handleCommand: HandleCommand = async () => {
      throw Object.assign(new Error("kaboom"), { code: "boom-code" });
    };
    await withSocketServer(handleCommand, async () => {
      const res = await fetch("http://localhost/tray:status", { unix: DAEMON_SOCK_PATH });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { ok: boolean; error: string; failure: { code: string; message: string } };
      expect(body.ok).toBe(false);
      expect(body.error).toContain("kaboom");
      expect(body.failure).toEqual({ code: "boom-code", message: "kaboom" });
    });
  });

  test("a thrown error with no .code falls back to the handler-threw failure code", async () => {
    const handleCommand: HandleCommand = async () => {
      throw new Error("plain failure");
    };
    await withSocketServer(handleCommand, async () => {
      const res = await fetch("http://localhost/tray:status", { unix: DAEMON_SOCK_PATH });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { failure: { code: string; message: string } };
      expect(body.failure).toEqual({ code: "handler-threw", message: "plain failure" });
    });
  });
});

describe("startSocketServer: request body size cap", () => {
  test("a body over MAX_REQUEST_BODY_SIZE is rejected with a 4xx before handleCommand runs", async () => {
    const calls: string[] = [];
    const handleCommand: HandleCommand = async (cmd) => {
      calls.push(cmd);
      return { ok: true };
    };
    await withSocketServer(handleCommand, async () => {
      const res = await fetch("http://localhost/cache:refresh", {
        unix: DAEMON_SOCK_PATH,
        method: "POST",
        body: "x".repeat(MAX_REQUEST_BODY_SIZE + 1024),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(calls).toEqual([]);
    });
  });

  test("a gate:open body of about 5 MB reaches handleCommand", async () => {
    const calls: string[] = [];
    const handleCommand: HandleCommand = async (cmd) => {
      calls.push(cmd);
      return { ok: true };
    };
    await withSocketServer(handleCommand, async () => {
      const res = await fetch("http://localhost/gate:open", {
        unix: DAEMON_SOCK_PATH,
        method: "POST",
        body: JSON.stringify({ context: "x".repeat(5 * 1024 * 1024) }),
      });
      expect(res.status).toBe(200);
      expect(calls).toEqual(["gate:open"]);
    });
  });

  test("a gate:ask body over GATE_REQUEST_LIMIT_BYTES is refused with 413 before handleCommand runs", async () => {
    const calls: string[] = [];
    const handleCommand: HandleCommand = async (cmd) => {
      calls.push(cmd);
      return { ok: true };
    };
    await withSocketServer(handleCommand, async () => {
      const res = await fetch("http://localhost/gate:ask", {
        unix: DAEMON_SOCK_PATH,
        method: "POST",
        body: JSON.stringify({ context: "x".repeat(GATE_REQUEST_LIMIT_BYTES + 1024 * 1024) }),
      });
      expect(res.status).toBe(413);
      expect(calls).toEqual([]);
    });
  });

  test("a non-gate request of 2 MiB is still refused with 413", async () => {
    const calls: string[] = [];
    const handleCommand: HandleCommand = async (cmd) => {
      calls.push(cmd);
      return { ok: true };
    };
    await withSocketServer(handleCommand, async () => {
      const res = await fetch("http://localhost/cache:refresh", {
        unix: DAEMON_SOCK_PATH,
        method: "POST",
        body: JSON.stringify({ x: "x".repeat(2 * 1024 * 1024) }),
      });
      expect(res.status).toBe(413);
      expect(calls).toEqual([]);
    });
  });

});

describe("startSocketServer: availability", () => {
  const post = (cmd: string) =>
    fetch(`http://localhost/${cmd}`, { unix: DAEMON_SOCK_PATH, method: "POST", body: JSON.stringify({ text: "hi" }) });

  test("a starting daemon answers 503 unavailable and never calls handleCommand", async () => {
    const calls: string[] = [];
    const availability = createSocketAvailability();
    await withSocketServer(async (cmd) => { calls.push(cmd); return { ok: true }; }, async () => {
      const res = await post("chat:post");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "rt daemon is starting; try again in a moment", unavailable: "starting" });
      expect(calls).toEqual([]);
      expect(availability.inFlight).toBe(0);
    }, availability);
  });

  test("a stopping daemon answers 503 with the restarting sentence", async () => {
    const calls: string[] = [];
    const availability = createSocketAvailability();
    availability.state = "stopping";
    await withSocketServer(async (cmd) => { calls.push(cmd); return { ok: true }; }, async () => {
      const res = await post("chat:post");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "rt daemon is restarting; try again in a moment", unavailable: "stopping" });
      expect(calls).toEqual([]);
    }, availability);
  });

  test("a serving daemon dispatches, and inFlight is 1 during the handler and 0 after", async () => {
    const availability = createSocketAvailability();
    availability.state = "serving";
    let during = -1;
    await withSocketServer(async () => { during = availability.inFlight; return { ok: true, data: 1 }; }, async () => {
      const res = await post("chat:post");
      expect(await res.json()).toEqual({ ok: true, data: 1 });
      expect(during).toBe(1);
      expect(availability.inFlight).toBe(0);
    }, availability);
  });

  test("inFlight returns to 0 when the handler throws", async () => {
    const availability = createSocketAvailability();
    availability.state = "serving";
    await withSocketServer(async () => { throw new Error("kaboom"); }, async () => {
      const res = await post("chat:post");
      expect(res.status).toBe(500);
      expect(availability.inFlight).toBe(0);
    }, availability);
  });

  test("the starting reply carries the holder's pid and flavor, which the park gate reads", async () => {
    const availability = createSocketAvailability();
    availability.holder = { pid: 4242, flavor: "dev" };
    await withSocketServer(async () => ({ ok: true }), async () => {
      const res = await fetch("http://localhost/ping", { unix: DAEMON_SOCK_PATH });
      expect(await res.json()).toEqual({
        ok: false, error: "rt daemon is starting; try again in a moment", unavailable: "starting", pid: 4242, flavor: "dev",
      });
      expect(await probeSocketHolder()).toEqual({ flavor: "dev", pid: 4242, unavailable: "starting" });
    }, availability);
  });

  test("with no availability passed, requests dispatch as before", async () => {
    const calls: string[] = [];
    await withSocketServer(async (cmd) => { calls.push(cmd); return { ok: true }; }, async () => {
      const res = await post("chat:post");
      expect(res.status).toBe(200);
      expect(calls).toEqual(["chat:post"]);
    });
  });
});
