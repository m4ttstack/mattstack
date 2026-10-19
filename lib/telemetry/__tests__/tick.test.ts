import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import type { PingVersions, TelemetryPing } from "../ping.ts";
import { makeTelemetryTick, type TickDeps } from "../tick.ts";

const MIN = 60_000;

function fakeLog() {
  const calls: { level: string; args: unknown[] }[] = [];
  const log = new Proxy({}, { get: (_t, level: string) => (...args: unknown[]) => void calls.push({ level, args }) }) as unknown as Logger;
  return { log, calls };
}

function harness(overrides: Partial<TickDeps> = {}) {
  const state = { enabled: true, now: 1_000_000, versions: { appVersion: "2.30.1", rtVersion: "2.30.1" } as PingVersions, status: 200, token: "tok" as string | null };
  const posts: { url: string; body: string; token: string | null }[] = [];
  const collects: number[] = [];
  const { log, calls } = fakeLog();
  const deps: TickDeps = {
    enabled: () => state.enabled,
    versions: async () => state.versions,
    collect: async () => {
      collects.push(state.now);
      return { installId: "id", ...state.versions } as unknown as TelemetryPing;
    },
    token: async () => state.token,
    post: async (url, body, token) => {
      posts.push({ url, body, token });
      return state.status;
    },
    url: () => "https://relay.test/telemetry/ping",
    now: () => state.now,
    log,
    ...overrides,
  };
  return { state, posts, collects, calls, tick: makeTelemetryTick(deps) };
}

const loud = (calls: { level: string }[]) => calls.filter((c) => c.level !== "debug");

describe("makeTelemetryTick", () => {
  test("sends first, holds for 50 minutes, then sends again", async () => {
    const h = harness();
    await h.tick();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]!.url).toBe("https://relay.test/telemetry/ping");
    expect(JSON.parse(h.posts[0]!.body).installId).toBe("id");

    h.state.now += 5 * MIN;
    await h.tick();
    expect(h.posts).toHaveLength(1);

    h.state.now += 40 * MIN;
    await h.tick();
    expect(h.posts).toHaveLength(1);

    h.state.now += 5 * MIN;
    await h.tick();
    expect(h.posts).toHaveLength(2);
  });

  test("sends 5 minutes after the rt version changes", async () => {
    const h = harness();
    await h.tick();
    h.state.now += 5 * MIN;
    h.state.versions = { appVersion: "2.30.1", rtVersion: "2.31.0" };
    await h.tick();
    expect(h.posts).toHaveLength(2);
  });

  test("sends 5 minutes after the app version changes", async () => {
    const h = harness();
    await h.tick();
    h.state.now += 5 * MIN;
    h.state.versions = { appVersion: null, rtVersion: "2.30.1" };
    await h.tick();
    expect(h.posts).toHaveLength(2);
  });

  test("does nothing while disabled and sends once re-enabled", async () => {
    const h = harness();
    h.state.enabled = false;
    await h.tick();
    expect(h.collects).toHaveLength(0);
    expect(h.posts).toHaveLength(0);

    h.state.enabled = true;
    h.state.now += 5 * MIN;
    await h.tick();
    expect(h.posts).toHaveLength(1);
  });

  test.each([0, 500, 404])("status %d resolves quietly and the next tick retries", async (status) => {
    const h = harness();
    h.state.status = status;
    await h.tick();
    expect(h.posts).toHaveLength(1);
    expect(loud(h.calls)).toEqual([]);

    h.state.now += 5 * MIN;
    h.state.status = 200;
    await h.tick();
    expect(h.posts).toHaveLength(2);

    h.state.now += 5 * MIN;
    await h.tick();
    expect(h.posts).toHaveLength(2);
  });

  test("passes the token through, or null when there is none", async () => {
    const h = harness();
    await h.tick();
    expect(h.posts[0]!.token).toBe("tok");

    const none = harness();
    none.state.token = null;
    await none.tick();
    expect(none.posts[0]!.token).toBeNull();
  });

  const throwers: Record<string, () => Partial<TickDeps>> = {
    collect: () => ({ collect: async () => { throw new Error("cannot write id"); } }),
    versions: () => ({ versions: async () => { throw new Error("boom"); } }),
    token: () => ({ token: async () => { throw new Error("boom"); } }),
    post: () => ({ post: async () => { throw new Error("boom"); } }),
  };

  test.each(Object.keys(throwers))("a throwing %s is logged at debug and resolves", async (which) => {
    const h = harness(throwers[which]!());
    await expect(h.tick()).resolves.toBeUndefined();
    expect(loud(h.calls)).toEqual([]);
    expect(h.calls.some((c) => c.level === "debug")).toBe(true);
  });

  test("a failed collect does not advance the last-sent state", async () => {
    let fail = true;
    const h = harness({
      collect: async () => {
        if (fail) throw new Error("cannot write id");
        return { installId: "id" } as unknown as TelemetryPing;
      },
    });
    await h.tick();
    expect(h.posts).toHaveLength(0);
    fail = false;
    h.state.now += 5 * MIN;
    await h.tick();
    expect(h.posts).toHaveLength(1);
  });

  test("a tick that fires while one is in flight returns without sending", async () => {
    let release!: (status: number) => void;
    const gate = new Promise<number>((r) => (release = r));
    const h = harness({ post: async () => gate });
    const first = h.tick();
    await Promise.resolve();
    await h.tick();
    expect(h.collects).toHaveLength(1);
    release(200);
    await first;
    expect(h.collects).toHaveLength(1);
  });

  test("the in-flight guard clears after a throw", async () => {
    let fail = true;
    const h = harness({
      token: async () => {
        if (fail) throw new Error("boom");
        return null;
      },
    });
    await h.tick();
    fail = false;
    h.state.now += 5 * MIN;
    await h.tick();
    expect(h.posts).toHaveLength(1);
  });
});
