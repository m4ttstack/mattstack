import { describe, expect, test } from "bun:test";

import { switchboardUrl } from "../../../packages/rt-client/src/switchboard.ts";
import { UserActionableError } from "../../errors.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { Probes } from "../../setup/probes.ts";
import { peerOwnBoard, type PeerSeams } from "../peer.ts";

type Reply = { status: number; body: string; headers: Record<string, string> };
const reply = (status: number, body: unknown = ""): Reply => ({ status, body: typeof body === "string" ? body : JSON.stringify(body), headers: {} });

function seams(secrets: Record<string, string>, overrides: Partial<PeerSeams> = {}) {
  const written: Array<[string, string]> = [];
  const s: PeerSeams = {
    readLocalSecret: async (key) => secrets[key] ?? null,
    writeLocalSecret: async (key, value) => {
      written.push([key, value]);
    },
    localStoreReady: async () => true,
    boardUsername: async () => "Matt",
    ...overrides,
  };
  return { s, written };
}

function probes(route: (url: string, method: string) => Reply): Probes & { calls: { fetchInits: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> } } {
  return fakeProbes({ fetch: async (url, init) => route(url, init?.method ?? "GET") });
}

async function rejection(promise: Promise<unknown>): Promise<UserActionableError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("expected a rejection");
}

describe("peerOwnBoard", () => {
  test("with the admin token it registers the board under its canonical username and stores the token where join does", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(200, { token: "board-tok" }) : url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)));
    const { s, written } = seams({ switchboardAdminToken: "admin" });

    const result = await peerOwnBoard(p, "acme", { rotate: false }, s);

    expect(result).toEqual({ outcome: "connected", username: "matt", boardEnvOverrides: false });
    expect(written).toEqual([["switchboardToken", "board-tok"]]);
    const post = p.calls.fetchInits.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe(`${switchboardUrl()}/boards`);
    expect(post.init?.headers?.Authorization).toBe("Bearer admin");
    expect(JSON.parse(post.init!.body!)).toEqual({ username: "matt" });
    expect(p.calls.fetchInits.every((c) => c.url.startsWith(switchboardUrl()))).toBe(true);
  });

  test("a stored token the switchboard accepts is already connected: nothing registered, nothing written", async () => {
    const p = probes((url) => (url.endsWith("/peers") ? reply(200, { peers: [] }) : reply(500)));
    const { s, written } = seams({ switchboardAdminToken: "admin", switchboardToken: "works" });

    const result = await peerOwnBoard(p, "acme", { rotate: false }, s);

    expect(result.outcome).toBe("already-connected");
    expect(written).toEqual([]);
    expect(p.calls.fetchInits.some((c) => c.init?.method === "POST")).toBe(false);
  });

  test("--rotate issues a new token even when this Mac's stored token still works", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(201, { token: "rotated" }) : url.endsWith("/peers") ? reply(200, { peers: [] }) : reply(500)));
    const { s, written } = seams({ switchboardAdminToken: "admin", switchboardToken: "works" });

    const result = await peerOwnBoard(p, "acme", { rotate: true }, s);

    expect(result.outcome).toBe("connected");
    expect(written).toEqual([["switchboardToken", "rotated"]]);
    expect(p.calls.fetchInits.some((c) => c.url.endsWith("/peers"))).toBe(false);
  });

  test("a board the switchboard already knows, with no working token here, is left alone unless --rotate", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(200, { token: "fresh" }) : url.endsWith("/boards") ? reply(200, { boards: [{ username: "MATT" }] }) : reply(401)));
    const { s, written } = seams({ switchboardAdminToken: "admin" });

    const err = await rejection(peerOwnBoard(p, "acme", { rotate: false }, s));
    expect(err.code).toBe("board-registered-elsewhere");
    expect(err.next).toBe("rt team peer --rotate");
    expect(written).toEqual([]);

    expect((await peerOwnBoard(p, "acme", { rotate: true }, s)).outcome).toBe("connected");
    expect(written).toEqual([["switchboardToken", "fresh"]]);
  });

  test("without the admin token it refuses, pointing at an invite, and writes nothing", async () => {
    const p = probes(() => reply(500));
    const { s, written } = seams({});

    const err = await rejection(peerOwnBoard(p, "acme", { rotate: false }, s));

    expect(err.code).toBe("peer-needs-owner");
    expect(err.why).toContain("invite you again");
    expect(err.why).not.toContain("rt team");
    expect(err.next).toBe("rt team join");
    expect(written).toEqual([]);
    expect(p.calls.fetchInits).toEqual([]);
  });

  test("a relay error is a failure naming what the switchboard answered", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(503) : url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)));
    const { s, written } = seams({ switchboardAdminToken: "admin" });

    const err = await rejection(peerOwnBoard(p, "acme", { rotate: false }, s));

    expect(err.code).toBe("switchboard-refused");
    expect(err.why).toContain("503");
    expect(written).toEqual([]);
  });

  test("an unreachable switchboard says rt could not reach it, not that it answered 0", async () => {
    const p = probes(() => reply(0));
    const { s, written } = seams({ switchboardAdminToken: "admin" });

    const err = await rejection(peerOwnBoard(p, "acme", { rotate: false }, s));

    expect(err.code).toBe("switchboard-refused");
    expect(err.why).toBe("rt could not reach the switchboard.");
    expect(written).toEqual([]);
  });

  test("an unknown username or an unready secrets store stops before anything is registered", async () => {
    const p = probes((url) => (url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)));
    const noName = seams({ switchboardAdminToken: "admin" }, { boardUsername: async () => null });
    expect((await rejection(peerOwnBoard(p, "acme", { rotate: false }, noName.s))).code).toBe("board-username-unknown");

    const noStore = seams({ switchboardAdminToken: "admin" }, { localStoreReady: async () => false });
    expect((await rejection(peerOwnBoard(p, "acme", { rotate: false }, noStore.s))).code).toBe("secrets-store-not-ready");
    expect(p.calls.fetchInits.some((c) => c.init?.method === "POST")).toBe(false);
  });

  test("the admin token in the environment counts, the way the setup row reads it", async () => {
    const p = fakeProbes({
      env: { SWITCHBOARD_ADMIN_TOKEN: "env-admin" },
      fetch: async (url, init) => (init?.method === "POST" ? reply(200, { token: "t" }) : url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)),
    });
    const { s } = seams({});

    expect((await peerOwnBoard(p, "acme", { rotate: false }, s)).outcome).toBe("connected");
    expect(p.calls.fetchInits.find((c) => c.init?.method === "POST")?.init?.headers?.Authorization).toBe("Bearer env-admin");
  });
});
