import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { listWorktreeRoots, listWorktrees } from "../git-worktrees.ts";

let tmpRoot: string;

beforeEach(() => {
  // Resolve symlinks (macOS /var → /private/var) so paths match what
  // `git worktree list --porcelain` returns.
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-git-worktrees-")));
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* */ }
});

function initRepo(path: string): void {
  execSync(`git init -q "${path}"`);
  // git refuses worktree operations on a repo with no commits.
  writeFileSync(join(path, "README"), "x");
  execSync(`git -C "${path}" add . && git -C "${path}" -c user.email=t@t -c user.name=t commit -q -m init`);
}

describe("listWorktreeRoots", () => {
  test("returns empty array for a non-git directory", () => {
    expect(listWorktreeRoots(tmpRoot)).toEqual([]);
  });

  test("returns the primary worktree path for a fresh repo", () => {
    const repo = mkdtempSync(join(tmpRoot, "repo-"));
    initRepo(repo);
    expect(listWorktreeRoots(repo)).toEqual([repo]);
  });

  test("includes added linked worktrees", () => {
    const repo = mkdtempSync(join(tmpRoot, "repo-"));
    initRepo(repo);
    const linked = join(tmpRoot, "linked");
    execSync(`git -C "${repo}" worktree add -q "${linked}" -b feat/x`);
    expect(listWorktreeRoots(repo).sort()).toEqual([linked, repo].sort());
  });

  test("filters out worktrees whose directory was removed externally", () => {
    const repo = mkdtempSync(join(tmpRoot, "repo-"));
    initRepo(repo);
    const linked = join(tmpRoot, "linked-removed");
    execSync(`git -C "${repo}" worktree add -q "${linked}" -b feat/y`);
    rmSync(linked, { recursive: true, force: true });
    // Git still lists the worktree in porcelain output until pruned;
    // listWorktreeRoots must filter the missing dir out.
    expect(listWorktreeRoots(repo)).toEqual([repo]);
  });

  test("opts.env replaces the inherited environment, so GIT_DIR there redirects the listing to another repo", () => {
    const repoA = mkdtempSync(join(tmpRoot, "repo-a-"));
    initRepo(repoA);
    const repoB = mkdtempSync(join(tmpRoot, "repo-b-"));
    initRepo(repoB);
    const linkedB = join(tmpRoot, "linked-b");
    execSync(`git -C "${repoB}" worktree add -q "${linkedB}" -b feat/b`);

    const redirected = { ...process.env, GIT_DIR: join(repoB, ".git") };
    expect(listWorktreeRoots(repoA, { env: redirected }).sort()).toEqual([linkedB, repoB].sort());

    const cleared: Record<string, string | undefined> = { ...redirected };
    delete cleared.GIT_DIR;
    expect(listWorktreeRoots(repoA, { env: cleared })).toEqual([repoA]);
  });

  test("opts.timeoutMs on a directory with no git repo still returns an empty array rather than throwing past the caller", () => {
    expect(listWorktreeRoots(tmpRoot, { timeoutMs: 5_000 })).toEqual([]);
  });
});

describe("listWorktrees", () => {
  test("returns empty array for a non-git directory", () => {
    expect(listWorktrees(tmpRoot)).toEqual([]);
  });

  test("returns path and branch for the primary worktree", () => {
    const repo = mkdtempSync(join(tmpRoot, "repo-"));
    initRepo(repo);
    const result = listWorktrees(repo);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe(repo);
    // default branch is main or master depending on git config
    expect(["main", "master"]).toContain(result[0]!.branch);
  });

  test("includes linked worktrees with their branch names", () => {
    const repo = mkdtempSync(join(tmpRoot, "repo-"));
    initRepo(repo);
    const linked = join(tmpRoot, "linked");
    execSync(`git -C "${repo}" worktree add -q "${linked}" -b feat/x`);
    const byPath = Object.fromEntries(listWorktrees(repo).map((w) => [w.path, w.branch]));
    expect(byPath[linked]).toBe("feat/x");
  });

  test("filters out worktrees whose directory was removed externally", () => {
    const repo = mkdtempSync(join(tmpRoot, "repo-"));
    initRepo(repo);
    const linked = join(tmpRoot, "linked-removed");
    execSync(`git -C "${repo}" worktree add -q "${linked}" -b feat/y`);
    rmSync(linked, { recursive: true, force: true });
    expect(listWorktrees(repo).map((w) => w.path)).toEqual([repo]);
  });
});
