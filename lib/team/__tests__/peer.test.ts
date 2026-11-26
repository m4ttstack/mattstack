import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";

import { switchboardUrl } from "../../../packages/rt-client/src/switchboard.ts";
import { UserActionableError } from "../../errors.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { Probes } from "../../setup/probes.ts";
import { peerOwnBoard, realBoardUsername, realPeerSeams, type PeerSeams } from "../peer.ts";
import { teamLocalPath } from "../team-local.ts";
import { stageSecret } from "../../setup/staging.ts";
import { userSettingsPath } from "../../rt-paths.ts";
import { orgClones, orgToken } from "./org-token-fixtures.ts";

const ADMIN = orgToken("a");
const ADMIN_FILE = orgToken("b");
const ENV_ADMIN = orgToken("c");
const MASTER = "the-relay-operators-own-token";

type Reply = { status: number; body: string; headers: Record<string, string> };
const reply = (status: number, body: unknown = ""): Reply => ({ status, body: typeof body === "string" ? body : JSON.stringify(body), headers: {} });

function seams(secrets: Record<string, string>, overrides: Partial<PeerSeams> = {}) {
  const written: Array<[string, string]> = [];
  const s: PeerSeams = {
    readLocalSecret: async (key) => secrets[key] ?? null,
    readAdminSecret: async () => null,
    writeLocalSecret: async (key, value) => {
      written.push([key, value]);
    },
    localStoreReady: async () => true,
    boardUsername: async () => "Matt",
    ...overrides,
  };
  return { s, written };
}

/** A Mac with one org clone, so a token kept on this Mac counts. */
function probes(route: (url: string, method: string) => Reply, opts: { env?: Record<string, string>; orgs?: string[] } = {}): Probes & { calls: { fetchInits: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> } } {
  return fakeProbes({ ...orgClones("/fake-home", ...(opts.orgs ?? ["acme"])), env: opts.env ?? {}, fetch: async (url, init) => route(url, init?.method ?? "GET") });
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
    const { s, written } = seams({ switchboardAdminToken: ADMIN });

    const result = await peerOwnBoard(p, "acme", { rotate: false }, s);

    expect(result).toEqual({ outcome: "connected", username: "matt", boardEnvOverrides: false });
    expect(written).toEqual([["switchboardToken", "board-tok"]]);
    const post = p.calls.fetchInits.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe(`${switchboardUrl()}/boards`);
    expect(post.init?.headers?.Authorization).toBe(`Bearer ${ADMIN}`);
    expect(JSON.parse(post.init!.body!)).toEqual({ username: "matt" });
    expect(p.calls.fetchInits.every((c) => c.url.startsWith(switchboardUrl()))).toBe(true);
  });

  test("an admin whose token sits only in the org's admin-only file connects their board", async () => {
    const asked: Array<[string, string]> = [];
    const { s, written } = seams({}, {
      readAdminSecret: async (org, key) => {
        asked.push([org, key]);
        return ADMIN_FILE;
      },
    });
    const p = probes((url, method) => (method === "POST" ? reply(201, { token: "board-tok" }) : reply(200, { boards: [] })));

    const result = await peerOwnBoard(p, "acme", { rotate: false }, s);

    expect(result.outcome).toBe("connected");
    expect(asked).toEqual([["acme", "switchboardAdminToken"]]);
    expect(p.calls.fetchInits.find((c) => c.init?.method === "POST")?.init?.headers?.Authorization).toBe(`Bearer ${ADMIN_FILE}`);
    expect(written).toEqual([["switchboardToken", "board-tok"]]);
  });

  test("a stored token the switchboard accepts is already connected: nothing registered, nothing written", async () => {
    const p = probes((url) => (url.endsWith("/peers") ? reply(200, { peers: [] }) : reply(500)));
    const { s, written } = seams({ switchboardAdminToken: ADMIN, switchboardToken: "works" });

    const result = await peerOwnBoard(p, "acme", { rotate: false }, s);

    expect(result.outcome).toBe("already-connected");
    expect(written).toEqual([]);
    expect(p.calls.fetchInits.some((c) => c.init?.method === "POST")).toBe(false);
  });

  test("--rotate issues a new token even when this Mac's stored token still works", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(201, { token: "rotated" }) : url.endsWith("/peers") ? reply(200, { peers: [] }) : reply(500)));
    const { s, written } = seams({ switchboardAdminToken: ADMIN, switchboardToken: "works" });

    const result = await peerOwnBoard(p, "acme", { rotate: true }, s);

    expect(result.outcome).toBe("connected");
    expect(written).toEqual([["switchboardToken", "rotated"]]);
    expect(p.calls.fetchInits.some((c) => c.url.endsWith("/peers"))).toBe(false);
  });

  test("a board the switchboard already knows, with no working token here, is left alone unless --rotate", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(200, { token: "fresh" }) : url.endsWith("/boards") ? reply(200, { boards: [{ username: "MATT" }] }) : reply(401)));
    const { s, written } = seams({ switchboardAdminToken: ADMIN });

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

    expect(err.code).toBe("peer-needs-admin");
    expect(err.why).toContain("invite you again");
    expect(err.why).not.toContain("rt team");
    expect(err.next).toBe("rt team join");
    expect(written).toEqual([]);
    expect(p.calls.fetchInits).toEqual([]);
  });

  test("a relay error is a failure naming what the switchboard answered", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(503) : url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)));
    const { s, written } = seams({ switchboardAdminToken: ADMIN });

    const err = await rejection(peerOwnBoard(p, "acme", { rotate: false }, s));

    expect(err.code).toBe("switchboard-refused");
    expect(err.why).toContain("503");
    expect(written).toEqual([]);
  });

  test("an unreachable switchboard says rt could not reach it, not that it answered 0", async () => {
    const p = probes(() => reply(0));
    const { s, written } = seams({ switchboardAdminToken: ADMIN });

    const err = await rejection(peerOwnBoard(p, "acme", { rotate: false }, s));

    expect(err.code).toBe("switchboard-refused");
    expect(err.why).toBe("rt could not reach the switchboard.");
    expect(written).toEqual([]);
  });

  test("an unknown username or an unready secrets store stops before anything is registered", async () => {
    const p = probes((url) => (url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)));
    const noName = seams({ switchboardAdminToken: ADMIN }, { boardUsername: async () => null });
    expect((await rejection(peerOwnBoard(p, "acme", { rotate: false }, noName.s))).code).toBe("board-username-unknown");

    const noStore = seams({ switchboardAdminToken: ADMIN }, { localStoreReady: async () => false });
    expect((await rejection(peerOwnBoard(p, "acme", { rotate: false }, noStore.s))).code).toBe("secrets-store-not-ready");
    expect(p.calls.fetchInits.some((c) => c.init?.method === "POST")).toBe(false);
  });

  test("a registered board whose token cannot be saved says so and points at --rotate", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(201, { username: "matt", token: "board-tok" }) : url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)));
    const { s } = seams({ switchboardAdminToken: ADMIN }, { writeLocalSecret: async () => { throw new Error("keychain locked, token board-tok"); } });

    const err = await rejection(peerOwnBoard(p, "acme", { rotate: false }, s));

    expect(err.code).toBe("peer-store-failed");
    expect(err.next).toBe("rt team peer --rotate");
    expect(err.log).not.toContain("board-tok");
  });

  test("the admin token in the environment counts, the way the setup row reads it", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(200, { token: "t" }) : url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)), { env: { SWITCHBOARD_ADMIN_TOKEN: ENV_ADMIN } });
    const { s } = seams({});

    expect((await peerOwnBoard(p, "acme", { rotate: false }, s)).outcome).toBe("connected");
    expect(p.calls.fetchInits.find((c) => c.init?.method === "POST")?.init?.headers?.Authorization).toBe(`Bearer ${ENV_ADMIN}`);
  });

  test("a 409 from register throws username-taken", async () => {
    const p = probes((url, method) => (method === "POST" ? reply(409, { error: "username-taken" }) : url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404)));
    const { s, written } = seams({ switchboardAdminToken: ADMIN });

    const err = await rejection(peerOwnBoard(p, "acme", { rotate: false }, s));

    expect(err.code).toBe("username-taken");
    expect(err.message).toBe("Another org on the switchboard already has a board for matt");
    expect(err.why).toBe("Usernames are unique across the switchboard. Ask the relay operator.");
    expect(written).toEqual([]);
  });

  test("a master in env is never sent", async () => {
    const route = (url: string, method: string) => (method === "POST" ? reply(201, { token: "board-tok" }) : url.endsWith("/boards") ? reply(200, { boards: [] }) : reply(404));
    const bearers = (p: ReturnType<typeof probes>) => p.calls.fetchInits.map((c) => c.init?.headers?.Authorization);

    const alone = probes(route, { env: { SWITCHBOARD_ADMIN_TOKEN: MASTER } });
    const err = await rejection(peerOwnBoard(alone, "acme", { rotate: false }, seams({ switchboardAdminToken: MASTER }).s));
    expect(err.code).toBe("peer-needs-admin");
    expect(alone.calls.fetchInits).toEqual([]);

    const withFile = probes(route, { env: { SWITCHBOARD_ADMIN_TOKEN: MASTER } });
    expect((await peerOwnBoard(withFile, "acme", { rotate: false }, seams({}, { readAdminSecret: async () => ADMIN_FILE }).s)).outcome).toBe("connected");
    expect(bearers(withFile)).not.toContain(`Bearer ${MASTER}`);
    expect(bearers(withFile)).toContain(`Bearer ${ADMIN_FILE}`);
  });

  test("on a two-org Mac a token kept on this Mac is never used", async () => {
    const p = probes(() => reply(200, { boards: [] }), { orgs: ["acme", "beta"], env: { SWITCHBOARD_ADMIN_TOKEN: ENV_ADMIN } });
    const { s, written } = seams({ switchboardAdminToken: ADMIN });

    expect((await rejection(peerOwnBoard(p, "beta", { rotate: false }, s))).code).toBe("peer-needs-admin");
    expect(p.calls.fetchInits).toEqual([]);
    expect(written).toEqual([]);
  });
});

describe("realPeerSeams().boardUsername", () => {
  test("with no board.defaultMember, the username this Mac recorded for the org is the board's", async () => {
    const home = "/home/x";
    const p = fakeProbes({ home, files: { [teamLocalPath(home, "acme")]: JSON.stringify({ forgeUsername: "dev1" }) } });
    expect(await realPeerSeams().boardUsername(p, "acme")).toBe("dev1");
  });

  test("the recorded username wins over board.defaultMember, so peer and join register the same name", async () => {
    const store = userSettingsPath();
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify({ "board.defaultMember": "dev2" }));
    try {
      const home = "/home/x";
      const p = fakeProbes({ home, files: { [teamLocalPath(home, "acme")]: JSON.stringify({ forgeUsername: "dev1" }) } });
      expect(await realPeerSeams().boardUsername(p, "acme")).toBe("dev1");
    } finally {
      rmSync(store, { force: true });
    }
  });
});

describe("realPeerSeams().boardUsername and the GitLab token", () => {
  const home = "/home/x";
  const gitConfig = (remote: string) => ({ [`${home}/.mattstack/orgs/acme/.git/config`]: `[remote "origin"]\n\turl = ${remote}\n` });
  const userSettings = (forgeHost: string) => ({ [`${home}/.mattstack/user/settings.user.jsonc`]: JSON.stringify({ "rt.integrations": { forgeHost } }) });

  test("an unconfirmed gitlab-shaped host is refused and glab never runs", async () => {
    const p = fakeProbes({ home, files: gitConfig("https://gitlab.evil.example/acme/org.git") });
    stageSecret(p, "rt", "gitlabToken", "glpat-secret");

    const err = await rejection(realPeerSeams().boardUsername(p, "acme"));

    expect(err.code).toBe("forge-host-unconfirmed");
    expect(err.message).toContain("gitlab.evil.example");
    expect(p.calls.exec).toEqual([]);
    expect(p.calls.fetch).toEqual([]);
  });

  test("the confirmed host still asks glab for the login with the token", async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const p = fakeProbes({
      home,
      files: { ...gitConfig("https://gitlab.acme.internal/acme/org.git"), ...userSettings("gitlab.acme.internal") },
      exec: (_argv, opts) => {
        seen.push(opts?.env);
        return { code: 0, stdout: JSON.stringify({ username: "dev1" }), stderr: "" };
      },
    });
    stageSecret(p, "rt", "gitlabToken", "glpat-secret");

    expect(await realPeerSeams().boardUsername(p, "acme")).toBe("dev1");
    expect(seen.some((env) => env?.GITLAB_TOKEN === "glpat-secret")).toBe(true);
  });
});

describe("realBoardUsername and a declared forge", () => {
  test("a declared GitLab forge on an unconfirmed host is refused though the remote is gitlab.com", async () => {
    const home = "/home/x";
    const p = fakeProbes({ home, files: { [`${home}/.mattstack/orgs/acme/.git/config`]: `[remote "origin"]\n\turl = https://gitlab.com/acme/org.git\n` } });
    stageSecret(p, "rt", "gitlabToken", "glpat-secret");
    const read = <T,>(key: string): T | undefined => (key === "mattstack.integrations" ? ({ forge: { provider: "gitlab", host: "gitlab.evil.example" } } as T) : undefined);

    const err = await rejection(realBoardUsername(p, "acme", read));

    expect(err.code).toBe("forge-host-unconfirmed");
    expect(err.message).toContain("gitlab.evil.example");
    expect(p.calls.exec).toEqual([]);
  });
});
