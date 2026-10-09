import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { setSetting } from "../../packages/rt-client/src/index.ts";
import { seedOrg } from "../../packages/rt-client/test/org-fixture.ts";
import { orgDir } from "../../packages/rt-client/src/settings/paths.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { ConversionRefusal, assertNoLink, cloneRoot, preflight } from "../lib/org-conversion.ts";

const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const MANAGED = ["mattstack", ".claude-plugin"] as const;

describe("org conversion preflight", () => {
  const origHome = process.env.HOME;
  let home: string;
  let dir: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-conv-")));
    process.env.HOME = home;
    seedOrg({ username: "dev1" });
    dir = orgDir("acme");
    const git = (...argv: string[]) => execFileSync("git", ["-C", dir, ...argv], { env: { ...childEnv(), ...GIT_ENV, HOME: home } });
    git("init", "-q", "-b", "main");
    git("add", "--", ".");
    git("commit", "-q", "-m", "org");
    const origin = join(dirname(dir), "acme-origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: { ...childEnv(), HOME: home } });
    git("remote", "add", "origin", origin);
    git("push", "-q", "origin", "main");
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });
  const run = (...argv: string[]) => execFileSync(argv[0]!, argv.slice(1), { encoding: "utf8", env: { ...childEnv(), ...GIT_ENV, HOME: home } });
  const syncOff = () => setSetting("rt.teamSnapshot", { enabled: false }, "machine");
  function refusal(fn: () => unknown): ConversionRefusal {
    let thrown: unknown;
    try {
      fn();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConversionRefusal);
    return thrown as ConversionRefusal;
  }
  const check = () => preflight(cloneRoot(dir), "dev1", { managedFolders: MANAGED });

  test("a folder below the clone root is refused", () => {
    expect(refusal(() => cloneRoot(join(dir, "mattstack"))).message).toBe("Choose the root of the clone");
  });

  test("team sync on is refused", () => {
    expect(refusal(check).message).toBe("Team sync is on for this Mac");
  });

  test("a Mac recorded as someone else is refused", () => {
    syncOff();
    seedOrg({ username: "dev2" });
    expect(refusal(check).message).toBe("This Mac is recorded as dev2");
  });

  test("a dirty tree is refused", () => {
    syncOff();
    writeFileSync(join(dir, "mattstack", "new.json"), "{}");
    expect(refusal(check).message).toBe("The clone has uncommitted changes");
  });

  test("a detached HEAD is refused", () => {
    syncOff();
    run("git", "-C", dir, "switch", "-q", "--detach");
    expect(refusal(check).message).toBe("The clone has no branch checked out");
  });

  test("a clone behind origin is refused", () => {
    syncOff();
    const other = join(home, "other");
    run("git", "clone", "-q", join(dirname(dir), "acme-origin.git"), other);
    writeFileSync(join(other, "README.md"), "x");
    run("git", "-C", other, "add", "README.md");
    run("git", "-C", other, "commit", "-q", "-m", "ahead");
    run("git", "-C", other, "push", "-q", "origin", "main");
    expect(refusal(check).message).toBe("The clone is behind origin");
  });

  test("a clone ahead of origin is refused", () => {
    syncOff();
    writeFileSync(join(dir, "local.txt"), "x");
    run("git", "-C", dir, "add", "local.txt");
    run("git", "-C", dir, "commit", "-q", "-m", "local");
    expect(refusal(check).message).toBe("The clone has commits origin does not have");
  });

  test("a clean, current clone returns its branch and head", () => {
    syncOff();
    expect(check()).toEqual({ branch: "main", start: run("git", "-C", dir, "rev-parse", "HEAD").trim() });
  });

  test("assertNoLink refuses a path with a linked segment", () => {
    const outside = join(home, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(dir, "mattstack", "teams"));
    expect(refusal(() => assertNoLink(dir, "mattstack/teams/widgets/plugin")).message).toBe("The move paths contain a symbolic link");
    expect(() => assertNoLink(dir, "mattstack/org/settings.org.jsonc")).not.toThrow();
  });
});
