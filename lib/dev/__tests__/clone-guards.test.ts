import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkClone, fastForwardMain, realCloneGuardDeps, type CloneGuardDeps } from "../clone-guards.ts";

const GIT_ID = ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...GIT_ID, ...args], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function tryGit(cwd: string, ...args: string[]): void {
  try { git(cwd, ...args); } catch { /* a stopped rebase or merge exits nonzero on purpose */ }
}

/** A bare origin with one commit on main, and a clone of it. */
function fixture(): { origin: string; clone: string; upstream: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-clone-guards-")));
  const origin = join(root, "origin.git");
  const upstream = join(root, "upstream");
  const clone = join(root, "clone");
  git(root, "init", "--bare", origin);
  git(root, "init", upstream);
  writeFileSync(join(upstream, "a.txt"), "one\n");
  writeFileSync(join(upstream, ".gitignore"), "ignored.log\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "one");
  git(upstream, "remote", "add", "origin", origin);
  git(upstream, "push", "origin", "HEAD:main");
  git(root, "clone", origin, clone);
  return { origin, clone, upstream };
}

/** New commits on origin/main the clone does not have yet. */
function advanceOrigin(upstream: string, n: number): void {
  for (let i = 0; i < n; i++) {
    writeFileSync(join(upstream, `u${i}.txt`), `${i}\n`);
    git(upstream, "add", ".");
    git(upstream, "commit", "-m", `upstream ${i}`);
  }
  git(upstream, "push", "origin", "HEAD:main");
}

const deps = realCloneGuardDeps();

describe("checkClone", () => {
  test("a clean clone on main that is behind passes and reports how far", async () => {
    const { clone, upstream } = fixture();
    advanceOrigin(upstream, 2);
    expect(await checkClone(deps, clone)).toEqual({ ok: true, behind: 2 });
  });

  test("a clean clone on main that is up to date passes with behind 0", async () => {
    const { clone } = fixture();
    expect(await checkClone(deps, clone)).toEqual({ ok: true, behind: 0 });
  });

  test("another branch holds: notOnMain, with the branch named", async () => {
    const { clone } = fixture();
    git(clone, "switch", "-c", "feature-x");
    expect(await checkClone(deps, clone)).toEqual({ ok: false, hold: "notOnMain", detail: "Your clone is on feature-x, not main." });
  });

  test("a detached HEAD holds: notOnMain", async () => {
    const { clone } = fixture();
    git(clone, "switch", "--detach", "HEAD");
    expect(await checkClone(deps, clone)).toEqual({ ok: false, hold: "notOnMain", detail: "Your clone is not on a branch." });
  });

  test("a commit origin/main lacks holds: localCommits", async () => {
    const { clone } = fixture();
    writeFileSync(join(clone, "mine.txt"), "x\n");
    git(clone, "add", ".");
    git(clone, "commit", "-m", "mine");
    expect(await checkClone(deps, clone)).toEqual({ ok: false, hold: "localCommits", detail: "Your clone has 1 commit(s) that are not on origin/main." });
  });

  test("a modified tracked file holds: dirtyTree", async () => {
    const { clone } = fixture();
    writeFileSync(join(clone, "a.txt"), "changed\n");
    expect(await checkClone(deps, clone)).toEqual({ ok: false, hold: "dirtyTree", detail: "Your clone has uncommitted changes." });
  });

  test("a staged change holds: dirtyTree", async () => {
    const { clone } = fixture();
    writeFileSync(join(clone, "a.txt"), "staged\n");
    git(clone, "add", "a.txt");
    expect((await checkClone(deps, clone) as { hold?: string }).hold).toBe("dirtyTree");
  });

  test("an untracked file holds: dirtyTree", async () => {
    const { clone } = fixture();
    writeFileSync(join(clone, "new.txt"), "new\n");
    expect((await checkClone(deps, clone) as { hold?: string }).hold).toBe("dirtyTree");
  });

  test("an ignored file does not hold", async () => {
    const { clone } = fixture();
    writeFileSync(join(clone, "ignored.log"), "noise\n");
    expect(await checkClone(deps, clone)).toEqual({ ok: true, behind: 0 });
  });

  test("a rebase in progress holds: mergeInProgress", async () => {
    const { clone, upstream } = fixture();
    writeFileSync(join(upstream, "a.txt"), "theirs\n");
    git(upstream, "commit", "-am", "theirs");
    git(upstream, "push", "origin", "HEAD:main");
    writeFileSync(join(clone, "a.txt"), "ours\n");
    git(clone, "commit", "-am", "ours");
    git(clone, "fetch", "origin");
    tryGit(clone, "rebase", "origin/main");
    expect(await checkClone(deps, clone)).toEqual({ ok: false, hold: "mergeInProgress", detail: "Your clone has a merge or rebase in progress." });
  });

  test("a merge in progress holds: mergeInProgress", async () => {
    const { clone, upstream } = fixture();
    writeFileSync(join(upstream, "a.txt"), "theirs\n");
    git(upstream, "commit", "-am", "theirs");
    git(upstream, "push", "origin", "HEAD:main");
    writeFileSync(join(clone, "a.txt"), "ours\n");
    git(clone, "commit", "-am", "ours");
    git(clone, "fetch", "origin");
    tryGit(clone, "merge", "origin/main");
    expect((await checkClone(deps, clone) as { hold?: string }).hold).toBe("mergeInProgress");
  });

  test("a failed fetch holds: fetchFailed, and is not reported as local commits", async () => {
    const { clone } = fixture();
    writeFileSync(join(clone, "mine.txt"), "x\n");
    git(clone, "add", ".");
    git(clone, "commit", "-m", "mine");
    const failing: CloneGuardDeps = { ...deps, fetch: async () => ({ exitCode: 128 }) };
    expect(await checkClone(failing, clone)).toEqual({ ok: false, hold: "fetchFailed", detail: "rt could not fetch origin/main." });
  });

  test("a git status that fails or times out holds statusFailed, not dirtyTree", async () => {
    const { clone } = fixture();
    const failing: CloneGuardDeps = {
      ...deps,
      git: async (cwd, args, opts) => (args.includes("status") ? { stdout: "", exitCode: 143 } : deps.git(cwd, args, opts)),
    };
    expect(await checkClone(failing, clone)).toEqual({ ok: false, hold: "statusFailed", detail: "rt could not read your clone's status: git status failed or took too long." });
  });

  test("git status runs with --no-optional-locks, so it never takes index.lock", async () => {
    const { clone } = fixture();
    const seen: string[][] = [];
    const recording: CloneGuardDeps = { ...deps, git: async (cwd, args, opts) => { seen.push(args); return deps.git(cwd, args, opts); } };
    await checkClone(recording, clone);
    const status = seen.find((a) => a.includes("status"))!;
    expect(status.indexOf("--no-optional-locks")).toBeGreaterThanOrEqual(0);
    expect(status.indexOf("--no-optional-locks")).toBeLessThan(status.indexOf("status"));
  });

  test("the fetch brings no tags into the clone", async () => {
    const { clone, upstream } = fixture();
    advanceOrigin(upstream, 1);
    git(upstream, "tag", "v9.9.9");
    git(upstream, "push", "origin", "v9.9.9");
    expect(await checkClone(deps, clone)).toEqual({ ok: true, behind: 1 });
    expect(git(clone, "tag", "-l").trim()).toBe("");
  });

  test("checkClone leaves HEAD, the index and the working tree as they were", async () => {
    const { clone, upstream } = fixture();
    advanceOrigin(upstream, 1);
    writeFileSync(join(clone, "a.txt"), "changed\n");
    writeFileSync(join(clone, "new.txt"), "new\n");
    git(clone, "add", "new.txt");
    const before = { head: git(clone, "rev-parse", "HEAD"), status: git(clone, "status", "--porcelain"), a: readFileSync(join(clone, "a.txt"), "utf8") };
    await checkClone(deps, clone);
    expect({ head: git(clone, "rev-parse", "HEAD"), status: git(clone, "status", "--porcelain"), a: readFileSync(join(clone, "a.txt"), "utf8") }).toEqual(before);
  });

  test("a clone with no upstream configured still works", async () => {
    const { clone, upstream } = fixture();
    git(clone, "branch", "--unset-upstream");
    advanceOrigin(upstream, 1);
    expect(await checkClone(deps, clone)).toEqual({ ok: true, behind: 1 });
  });
});

describe("fastForwardMain", () => {
  test("fast-forwards main to origin/main", async () => {
    const { clone, upstream } = fixture();
    advanceOrigin(upstream, 1);
    git(clone, "fetch", "origin");
    expect((await fastForwardMain(deps, clone)).exitCode).toBe(0);
    expect(git(clone, "rev-parse", "HEAD")).toBe(git(clone, "rev-parse", "refs/remotes/origin/main"));
  });

  test("refuses when the clone left main after the check, and moves nothing", async () => {
    const { clone, upstream } = fixture();
    advanceOrigin(upstream, 1);
    git(clone, "fetch", "origin");
    git(clone, "switch", "-c", "feature-y");
    const before = git(clone, "rev-parse", "HEAD");
    const r = await fastForwardMain(deps, clone);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("not on main");
    expect(git(clone, "rev-parse", "HEAD")).toBe(before);
  });

  test("a failed fast-forward returns what git said on stderr", async () => {
    const { clone, upstream } = fixture();
    advanceOrigin(upstream, 1);
    git(clone, "fetch", "origin");
    writeFileSync(join(clone, "u0.txt"), "mine\n");
    const r = await fastForwardMain(deps, clone);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("would be overwritten");
  });
});
