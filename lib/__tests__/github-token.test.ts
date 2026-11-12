import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createGithubTokenResolver, ghSessionFingerprint, type GhTokenSeams } from "../github-token.ts";

function seams(results: Array<string | null>, clock = { now: 0 }, session = { fingerprint: "s1" }): GhTokenSeams & { calls: number; clock: { now: number } } {
  const s = {
    calls: 0,
    clock,
    ghToken: async () => {
      s.calls++;
      return results.shift() ?? null;
    },
    now: () => clock.now,
    sessionFingerprint: () => session.fingerprint,
  };
  return s;
}

describe("githubToken", () => {
  let s: ReturnType<typeof seams>;

  beforeEach(() => {
    s = seams(["gho_fromgh"]);
  });

  test("a stored token wins and never asks gh", async () => {
    const resolve = createGithubTokenResolver(s);
    expect(await resolve("ghp_stored")).toEqual({ token: "ghp_stored", source: "stored" });
    expect(s.calls).toBe(0);
  });

  test("no stored token falls back to the gh session", async () => {
    const resolve = createGithubTokenResolver(s);
    expect(await resolve(undefined)).toEqual({ token: "gho_fromgh", source: "gh" });
  });

  test("no stored token and no gh session resolves to null", async () => {
    const resolve = createGithubTokenResolver(seams([null]));
    expect(await resolve(undefined)).toBeNull();
  });

  test("the gh answer is reused within the TTL, including a miss", async () => {
    const miss = seams([null, "gho_later"]);
    const resolve = createGithubTokenResolver(miss);
    await resolve(undefined);
    await resolve(undefined);
    expect(miss.calls).toBe(1);
  });

  test("the gh answer is re-read once the TTL lapses", async () => {
    const clock = { now: 0 };
    const rotating = seams(["gho_old", "gho_new"], clock);
    const resolve = createGithubTokenResolver(rotating);
    expect((await resolve(undefined))?.token).toBe("gho_old");
    clock.now = 11 * 60_000;
    expect((await resolve(undefined))?.token).toBe("gho_new");
    expect(rotating.calls).toBe(2);
  });

  test("a changed gh session is re-read on the next call, inside the TTL", async () => {
    const session = { fingerprint: "s1" };
    const switched = seams(["gho_old", "gho_new"], { now: 0 }, session);
    const resolve = createGithubTokenResolver(switched);
    expect((await resolve(undefined))?.token).toBe("gho_old");
    session.fingerprint = "s2";
    expect((await resolve(undefined))?.token).toBe("gho_new");
    expect(switched.calls).toBe(2);
  });

  test("a cached miss is re-read as soon as the gh session changes", async () => {
    const session = { fingerprint: "absent" };
    const login = seams([null, "gho_fresh"], { now: 0 }, session);
    const resolve = createGithubTokenResolver(login);
    expect(await resolve(undefined)).toBeNull();
    session.fingerprint = "s1";
    expect((await resolve(undefined))?.token).toBe("gho_fresh");
  });

  test("a logout is seen on the next call", async () => {
    const session = { fingerprint: "s1" };
    const logout = seams(["gho_old", null], { now: 0 }, session);
    const resolve = createGithubTokenResolver(logout);
    expect((await resolve(undefined))?.token).toBe("gho_old");
    session.fingerprint = "absent";
    expect(await resolve(undefined)).toBeNull();
  });
});

describe("ghSessionFingerprint", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rt-ghcfg-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("reads hosts.yml under GH_CONFIG_DIR and changes when gh rewrites it", () => {
    const env = { GH_CONFIG_DIR: dir, HOME: "/nonexistent" };
    const absent = ghSessionFingerprint(env);
    writeFileSync(join(dir, "hosts.yml"), "github.com:\n    user: a\n");
    const loggedIn = ghSessionFingerprint(env);
    expect(loggedIn).not.toBe(absent);
    expect(ghSessionFingerprint(env)).toBe(loggedIn);
    writeFileSync(join(dir, "hosts.yml"), "github.com:\n    user: someone-else\n");
    expect(ghSessionFingerprint(env)).not.toBe(loggedIn);
    unlinkSync(join(dir, "hosts.yml"));
    expect(ghSessionFingerprint(env)).toBe(absent);
  });

  test("falls back to XDG_CONFIG_HOME/gh, then HOME/.config/gh", () => {
    const absent = ghSessionFingerprint({ GH_CONFIG_DIR: join(dir, "none") });
    mkdirSync(join(dir, "xdg", "gh"), { recursive: true });
    writeFileSync(join(dir, "xdg", "gh", "hosts.yml"), "x");
    mkdirSync(join(dir, "home", ".config", "gh"), { recursive: true });
    writeFileSync(join(dir, "home", ".config", "gh", "hosts.yml"), "yy");
    const viaXdg = ghSessionFingerprint({ XDG_CONFIG_HOME: join(dir, "xdg"), HOME: join(dir, "home") });
    expect(viaXdg).not.toBe(absent);
    expect(viaXdg).toBe(ghSessionFingerprint({ GH_CONFIG_DIR: join(dir, "xdg", "gh") }));
    const viaHome = ghSessionFingerprint({ HOME: join(dir, "home") });
    expect(viaHome).not.toBe(absent);
    expect(viaHome).toBe(ghSessionFingerprint({ GH_CONFIG_DIR: join(dir, "home", ".config", "gh") }));
  });
});
