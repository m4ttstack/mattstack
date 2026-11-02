import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import {
  clearGitHubSignIn,
  githubLoginIfCanCreateRepos,
  pollDeviceToken,
  readGitHubSignIn,
  requestDeviceCode,
  writeGitHubSignIn,
} from "../github-signin.ts";
import { fakeProbes } from "./fakes.ts";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, body: JSON.stringify(body), headers });

describe("requestDeviceCode", () => {
  test("posts the client id and repo scope and maps the reply", async () => {
    const p = fakeProbes({
      now: new Date("2026-01-01T00:00:00Z"),
      fetch: async () => json(200, { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 }),
    });
    const code = await requestDeviceCode(p, "acme-client");
    expect(code).toEqual({ deviceCode: "dc", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", intervalSec: 5, expiresAt: "2026-01-01T00:15:00.000Z" });
    const call = p.calls.fetchInits[0]!;
    expect(call.url).toBe("https://github.com/login/device/code");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe("client_id=acme-client&scope=repo");
    expect(call.init?.headers?.Accept).toBe("application/json");
    expect(call.init?.timeoutMs).toBe(15000);
  });

  test("refuses when the client id is empty", async () => {
    const p = fakeProbes();
    const err = await requestDeviceCode(p, "").catch((e) => e);
    expect(err).toBeInstanceOf(UserActionableError);
    expect(err.message).toBe("GitHub sign-in isn't set up in this build");
    expect(p.calls.fetch).toEqual([]);
  });

  test("throws on a non-200", async () => {
    const p = fakeProbes({ fetch: async () => json(500, {}) });
    await expect(requestDeviceCode(p, "acme-client")).rejects.toBeInstanceOf(UserActionableError);
  });

  test("keeps GitHub's error as the reason", async () => {
    const p = fakeProbes({ fetch: async () => json(200, { error: "device_flow_disabled" }) });
    const err = await requestDeviceCode(p, "acme-client").catch((e) => e);
    expect(err.why).toContain("device_flow_disabled");
  });
});

describe("pollDeviceToken", () => {
  const poll = (body: unknown) => pollDeviceToken(fakeProbes({ fetch: async () => json(200, body) }), "dc", "acme-client");

  test("maps each reply", async () => {
    expect(await poll({ access_token: "tok" })).toEqual({ kind: "token", token: "tok" });
    expect(await poll({ error: "authorization_pending" })).toEqual({ kind: "pending" });
    expect(await poll({ error: "slow_down", interval: 10 })).toEqual({ kind: "slow-down", intervalSec: 10 });
    expect(await poll({ error: "expired_token" })).toEqual({ kind: "expired" });
    expect(await poll({ error: "access_denied" })).toEqual({ kind: "declined" });
  });

  test("posts the device grant", async () => {
    const p = fakeProbes({ fetch: async () => json(200, { error: "authorization_pending" }) });
    await pollDeviceToken(p, "dc", "acme-client");
    const call = p.calls.fetchInits[0]!;
    expect(call.url).toBe("https://github.com/login/oauth/access_token");
    expect(call.init?.body).toBe("client_id=acme-client&device_code=dc&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");
  });

  test("a network failure reads as pending", async () => {
    const p = fakeProbes({ fetch: async () => ({ status: 0, body: "", headers: {} }) });
    expect(await pollDeviceToken(p, "dc", "acme-client")).toEqual({ kind: "pending" });
  });
});

describe("githubLoginIfCanCreateRepos", () => {
  const check = (res: ReturnType<typeof json>) => githubLoginIfCanCreateRepos(fakeProbes({ fetch: async () => res }), "tok");

  test("returns the login when repo scope is granted", async () => {
    expect(await check(json(200, { login: "janedoe" }, { "x-oauth-scopes": "read:org, repo" }))).toBe("janedoe");
  });
  test("null without repo scope, without the header, or on 401", async () => {
    expect(await check(json(200, { login: "janedoe" }, { "x-oauth-scopes": "read:org" }))).toBeNull();
    expect(await check(json(200, { login: "janedoe" }))).toBeNull();
    expect(await check(json(401, {}))).toBeNull();
  });
  test("sends the token as a bearer", async () => {
    const p = fakeProbes({ fetch: async () => json(200, { login: "janedoe" }, { "x-oauth-scopes": "repo" }) });
    await githubLoginIfCanCreateRepos(p, "tok");
    expect(p.calls.fetchInits[0]!.init?.headers?.Authorization).toBe("Bearer tok");
  });
});

describe("sign-in record", () => {
  const base = { userCode: "ABCD-1234", url: "https://github.com/login/device", expiresAt: "2026-01-01T00:15:00.000Z" };
  const path = "/home/janedoe/.mattstack/rt/logins/github.json";
  const probes = () => fakeProbes({ home: "/home/janedoe", now: new Date("2026-01-01T00:00:00Z") });

  test("writes 0600 under logins and reads back", () => {
    const p = probes();
    writeGitHubSignIn(p, { ...base, pid: 42 });
    expect(p.calls.writes[path]).toBeDefined();
    expect(p.calls.modes[path]).toBe(0o600);
    expect(readGitHubSignIn(p, () => true)).toEqual({ ...base, pid: 42 });
  });

  test("null when there is no record", () => {
    expect(readGitHubSignIn(probes())).toBeNull();
  });

  test("null past expiresAt with no outcome", () => {
    const p = fakeProbes({ home: "/home/janedoe", now: new Date("2026-01-01T00:16:00Z") });
    writeGitHubSignIn(p, { ...base, pid: 42 });
    expect(readGitHubSignIn(p, () => true)).toBeNull();
  });

  test("null with a dead pid", () => {
    const p = probes();
    writeGitHubSignIn(p, { ...base, pid: 42 });
    expect(readGitHubSignIn(p, () => false)).toBeNull();
  });

  test("a null pid counts as live until expiresAt", () => {
    const p = probes();
    writeGitHubSignIn(p, { ...base, pid: null });
    expect(readGitHubSignIn(p, () => false)).toEqual({ ...base, pid: null });
  });

  test("an outcome is returned even with a dead pid", () => {
    const p = probes();
    writeGitHubSignIn(p, { ...base, pid: 42, outcome: "declined" });
    expect(readGitHubSignIn(p, () => false)?.outcome).toBe("declined");
  });

  test("an outcome is returned past expiresAt", () => {
    const p = fakeProbes({ home: "/home/janedoe", now: new Date("2026-01-01T00:16:00Z") });
    writeGitHubSignIn(p, { ...base, pid: 42, outcome: "expired" });
    expect(readGitHubSignIn(p, () => false)?.outcome).toBe("expired");
  });

  test("an unparseable expiresAt reads as expired", () => {
    const p = probes();
    writeGitHubSignIn(p, { ...base, expiresAt: "soon", pid: 42 });
    expect(readGitHubSignIn(p, () => true)).toBeNull();
  });

  test("the logins dir is 0700 and no temp file is left", () => {
    const p = probes();
    writeGitHubSignIn(p, { ...base, pid: 42 });
    expect(p.calls.modes["/home/janedoe/.mattstack/rt/logins"]).toBe(0o700);
    expect(p.readFile(`${path}.tmp`)).toBeNull();
  });

  test("clear removes the record", () => {
    const p = probes();
    writeGitHubSignIn(p, { ...base, pid: 42 });
    clearGitHubSignIn(p);
    expect(readGitHubSignIn(p, () => true)).toBeNull();
  });
});
