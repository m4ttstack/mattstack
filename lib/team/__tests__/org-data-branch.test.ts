import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRealProbes, execWithTimeout, type Probes } from "../../setup/probes.ts";
import { convergeDataBranch, heldCopy, moveBlocker, moveCloneToDataBranch, MOVED_DONE } from "../org-data-branch.ts";

const p = { exec: execWithTimeout };
const MARKER = '{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}';
const LEGACY_MARKER = '{"role":"org","org":"acme","layout":3}';
const TEAM_FILE = "mattstack/teams/widgets/settings.team.jsonc";

let root: string;
let home: string;
let origin: string;
let clone: string;
let seed: string;
let n = 0;

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

function put(dir: string, rel: string, body: string): void {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "org-data-branch-"));
  home = join(root, "home");
  mkdirSync(home);
  process.env.HOME = home;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  const base = join(root, `case${n++}`);
  origin = join(base, "origin.git");
  clone = join(base, "clone");
  seed = join(base, "seed");
  mkdirSync(seed, { recursive: true });
  git(base, "init", "-q", "--bare", "-b", "main", origin);

  git(base, "init", "-q", "-b", "main", seed);
  git(seed, "remote", "add", "origin", origin);
  put(seed, ".mattstack-org.json", LEGACY_MARKER);
  put(seed, "mattstack/mattstack.jsonc", LEGACY_MARKER);
  put(seed, "mattstack/org/settings.org.jsonc", "{}");
  put(seed, TEAM_FILE, "{}");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "legacy main");
  git(seed, "push", "-q", "origin", "main");
  git(base, "clone", "-q", origin, clone);
  git(clone, "config", "user.name", "dev1");
  git(clone, "config", "user.email", "dev1@example.com");

  git(seed, "checkout", "-q", "--orphan", "mattstack");
  put(seed, ".mattstack-org.json", MARKER);
  put(seed, "mattstack/mattstack.jsonc", MARKER);
  put(seed, "mattstack/org/settings.org.jsonc", "{}");
  put(seed, TEAM_FILE, "{}");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "data branch");
  git(seed, "push", "-q", "origin", "mattstack");
}, 30_000);

describe("moveCloneToDataBranch", () => {
  test("a clean layout 3 clone moves in place to the data branch", async () => {
    const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(r).toEqual({ kind: "moved", branch: "mattstack" });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("mattstack");
    expect(git(clone, "config", "--get-all", "remote.origin.fetch")).toBe("+refs/heads/mattstack:refs/remotes/origin/mattstack");
    expect(existsSync(join(clone, "mattstack/org/settings.org.jsonc"))).toBe(true);
  });

  test("a clone with an unsaved edit is held and keeps it", async () => {
    writeFileSync(join(clone, TEAM_FILE), "{ /* edit */ }");
    const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(r).toEqual({ kind: "held", why: "dirty", files: [TEAM_FILE] });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(await Bun.file(join(clone, TEAM_FILE)).text()).toBe("{ /* edit */ }");
  });

  test("unpushed commits on the org store carry across and sit unpushed on the data branch with the same author", async () => {
    put(clone, "mattstack/org/settings.org.jsonc", '{"carried":true}');
    git(clone, "commit", "-aq", "--author", "dev2 <dev2@example.com>", "-m", "local only");
    const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(r).toEqual({ kind: "moved", branch: "mattstack", carried: 1 });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("mattstack");
    expect(git(clone, "log", "-1", "--format=%an %s")).toBe("dev2 local only");
    expect(git(clone, "rev-list", "--count", "HEAD", "--not", "--remotes=origin")).toBe("1");
    expect(await Bun.file(join(clone, "mattstack/org/settings.org.jsonc")).text()).toBe('{"carried":true}');
    expect(git(clone, "config", "--get-all", "remote.origin.fetch")).toBe("+refs/heads/mattstack:refs/remotes/origin/mattstack");
  });

  test("a commit that changes files outside the org's data holds, and nothing moves", async () => {
    put(clone, "apps/x/readme.md", "mine");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "outside");
    const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(r).toEqual({ kind: "held", why: "uncarried", commits: 1, reason: "outside" });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(clone, "log", "-1", "--format=%s")).toBe("outside");
  });

  test("a commit that clashes with the data branch holds, and leaves main, the commit and the refspec as they were", async () => {
    git(seed, "checkout", "-q", "mattstack");
    put(seed, TEAM_FILE, '{"data":true}');
    git(seed, "commit", "-aq", "-m", "data edit");
    git(seed, "push", "-q", "origin", "mattstack");
    put(clone, TEAM_FILE, '{"mine":true}');
    git(clone, "commit", "-aq", "-m", "local only");
    const refspec = git(clone, "config", "--get-all", "remote.origin.fetch");
    const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(r).toEqual({ kind: "held", why: "uncarried", commits: 1, reason: "clash" });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(clone, "log", "-1", "--format=%s")).toBe("local only");
    expect(await Bun.file(join(clone, TEAM_FILE)).text()).toBe('{"mine":true}');
    expect(git(clone, "status", "--porcelain")).toBe("");
    expect(git(clone, "config", "--get-all", "remote.origin.fetch")).toBe(refspec);
    expect(() => git(clone, "rev-parse", "--verify", "-q", "refs/heads/mattstack")).toThrow();
  });

  test("a clone already on the branch is left alone", async () => {
    await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(await moveCloneToDataBranch(p, clone, "mattstack", null, origin)).toEqual({ kind: "already", branch: "mattstack" });
  });

  test("a branch the remote lacks fails without changing the clone", async () => {
    expect((await moveCloneToDataBranch(p, clone, "nope", null, origin)).kind).toBe("failed");
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  test("a detached HEAD is held, never moved", async () => {
    git(clone, "checkout", "-q", "--detach");
    const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(r).toEqual({ kind: "held", why: "detached" });
    expect(() => git(clone, "symbolic-ref", "-q", "HEAD")).toThrow();
  });

  test("local commits with no remote-tracking ref still count as unpushed, so they never vanish", async () => {
    put(clone, "mattstack/org/extra.jsonc", "{}");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "local only");
    git(clone, "update-ref", "-d", "refs/remotes/origin/main");
    const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(r).toMatchObject({ kind: "held", why: "uncarried" });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });
});

describe("moveBlocker", () => {
  test("a clean, pushed clone has nothing in the way", async () => {
    expect(await moveBlocker(p, clone)).toBeNull();
  });

  test("unpushed commits on the org's data alone do not block: the move carries them", async () => {
    put(clone, "mattstack/org/extra.jsonc", "{}");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "local only");
    expect(await moveBlocker(p, clone)).toBeNull();
  });

  test("an unpushed commit outside the org's data blocks", async () => {
    put(clone, "apps/x/readme.md", "mine");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "outside");
    expect(await moveBlocker(p, clone)).toEqual({ kind: "held", why: "uncarried", commits: 1, reason: "outside" });
  });

  test("names the same blocker the move would hold on", async () => {
    writeFileSync(join(clone, TEAM_FILE), "{ /* edit */ }");
    expect(await moveBlocker(p, clone)).toEqual({ kind: "held", why: "dirty", files: [TEAM_FILE] });
  });
});

describe("heldCopy", () => {
  test("a dirty clone names its files and the pull remedy", () => {
    expect(heldCopy({ kind: "held", why: "dirty", files: ["a.jsonc", "b.jsonc"] })).toEqual({
      detail: "Your copy of the org has unsaved changes: a.jsonc, b.jsonc",
      remedy: "Save or discard those changes, then run rt team pull",
    });
  });

  test("a long file list is cut short", () => {
    const files = ["a", "b", "c", "d", "e", "f", "g"];
    expect(heldCopy({ kind: "held", why: "dirty", files }).detail).toBe("Your copy of the org has unsaved changes: a, b, c, d, e and 2 more");
  });

  test("commits rt could not carry say why and name an org admin, never rt team publish", () => {
    expect(heldCopy({ kind: "held", why: "uncarried", commits: 1, reason: "outside" })).toEqual({
      detail: "rt could not carry 1 unpublished commit to the org's data branch, because it changes files outside the org's data",
      remedy: "Ask an org admin to help move it",
    });
    expect(heldCopy({ kind: "held", why: "uncarried", commits: 2, reason: "clash" })).toEqual({
      detail: "rt could not carry 2 unpublished commits to the org's data branch, because they clash with changes already there",
      remedy: "Ask an org admin to help move them",
    });
  });

  test("a detached copy asks for a branch", () => {
    expect(heldCopy({ kind: "held", why: "detached" })).toEqual({
      detail: "Your copy of the org is not on a branch",
      remedy: "Switch it back to a branch, then run rt team pull",
    });
  });
});

describe("convergeDataBranch", () => {
  const POINTER = '{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}';
  const probes = (): Probes => ({ ...createRealProbes(), home });
  const noToken = { readToken: async () => null };

  /** The admin's conversion: main keeps only the marker that points at the data branch. */
  function pointMain(): void {
    git(seed, "checkout", "-q", "main");
    git(seed, "rm", "-rq", "mattstack/org", "mattstack/teams");
    put(seed, "mattstack/mattstack.jsonc", POINTER);
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "pointer");
    git(seed, "push", "-q", "origin", "main");
  }

  test("a clean layout 3 clone whose origin main points at the data branch moves there and keeps its org files", async () => {
    pointMain();
    const r = await convergeDataBranch(probes(), clone, noToken);
    expect(r).toEqual({ kind: "moved", branch: "mattstack" });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("mattstack");
    expect(existsSync(join(clone, TEAM_FILE))).toBe(true);
    expect(git(clone, "config", "--get", "core.sparseCheckout")).toBe("true");
  });

  test("a dirty clone is held with its files and stays on main", async () => {
    pointMain();
    writeFileSync(join(clone, TEAM_FILE), "{ /* edit */ }");
    expect(await convergeDataBranch(probes(), clone, noToken)).toEqual({ kind: "held", why: "dirty", files: [TEAM_FILE] });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  test("nothing to move while origin main still holds the data", async () => {
    expect(await convergeDataBranch(probes(), clone, noToken)).toBeNull();
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  test("a trial branch whose own marker names the data branch is never moved", async () => {
    git(seed, "checkout", "-q", "-b", "trial", "mattstack");
    git(seed, "push", "-q", "origin", "trial");
    git(clone, "fetch", "-q", "origin", "trial:refs/remotes/origin/trial");
    git(clone, "checkout", "-q", "-b", "trial", "refs/remotes/origin/trial");
    expect(await convergeDataBranch(probes(), clone, noToken)).toBeNull();
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("trial");
  });

  test("an origin it cannot reach is a check that did not happen, never a failed move", async () => {
    pointMain();
    git(clone, "remote", "set-url", "origin", join(root, "nowhere.git"));
    expect((await convergeDataBranch(probes(), clone, noToken))?.kind).toBe("unchecked");
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  test("the moved sentence names the branch", () => {
    expect(MOVED_DONE("mattstack")).toBe("Moved your copy of the org to the mattstack branch");
    expect(MOVED_DONE("mattstack", 2)).toBe("Moved your copy of the org to the mattstack branch, with your 2 unpublished commits");
    expect(MOVED_DONE("mattstack", 1)).toBe("Moved your copy of the org to the mattstack branch, with your 1 unpublished commit");
  });
});
