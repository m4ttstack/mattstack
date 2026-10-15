import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execWithTimeout } from "../../setup/probes.ts";
import { moveCloneToDataBranch } from "../org-data-branch.ts";

const p = { exec: execWithTimeout };
const MARKER = '{"role":"org","org":"acme","layout":4,"dataBranch":"mattstack"}';
const LEGACY_MARKER = '{"role":"org","org":"acme","layout":3}';
const TEAM_FILE = "mattstack/teams/widgets/settings.team.jsonc";

let root: string;
let home: string;
let origin: string;
let clone: string;
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
  const seed = join(base, "seed");
  mkdirSync(seed, { recursive: true });
  git(base, "init", "-q", "--bare", "-b", "main", origin);

  git(base, "init", "-q", "-b", "main", seed);
  git(seed, "remote", "add", "origin", origin);
  put(seed, ".mattstack-org.json", LEGACY_MARKER);
  put(seed, "mattstack/org/settings.org.jsonc", "{}");
  put(seed, TEAM_FILE, "{}");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "legacy main");
  git(seed, "push", "-q", "origin", "main");
  git(base, "clone", "-q", origin, clone);

  git(seed, "checkout", "-q", "--orphan", "mattstack");
  put(seed, ".mattstack-org.json", MARKER);
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

  test("a clone with commits main never got is held", async () => {
    put(clone, "mattstack/org/extra.jsonc", "{}");
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "local only");
    const r = await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(r).toEqual({ kind: "held", why: "unpushed", commits: 1 });
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  test("a clone already on the branch is left alone", async () => {
    await moveCloneToDataBranch(p, clone, "mattstack", null, origin);
    expect(await moveCloneToDataBranch(p, clone, "mattstack", null, origin)).toEqual({ kind: "already", branch: "mattstack" });
  });

  test("a branch the remote lacks fails without changing the clone", async () => {
    expect((await moveCloneToDataBranch(p, clone, "nope", null, origin)).kind).toBe("failed");
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });
});
