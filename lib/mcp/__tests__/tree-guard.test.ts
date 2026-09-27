import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listWorktreeRoots } from "../../git-worktrees.ts";
import { checkRegisteredTree, findTreeByRealpath, realTreeGuardDeps, type TreeGuardDeps } from "../tree-guard.ts";

const deps: TreeGuardDeps = {
  repoIndex: () => ({ "remote:gitlab.com%2Facme%2Fapp": "/real/app" }),
  treeByPath: (p) => (p === "/real/pool/app-1" ? { repoName: "remote:gitlab.com%2Facme%2Fapp", tree: "app-1" } : null),
  realpath: (p) => { if (p.startsWith("/nope")) throw new Error("ENOENT"); return p.replace("/link/", "/real/"); },
  worktreeRoots: () => [],
};

describe("checkRegisteredTree", () => {
  test("accepts a registered checkout and a registered worktree, by realpath", () => {
    expect(checkRegisteredTree("/link/app", deps)).toEqual({ ok: true, path: "/real/app", repoName: "remote:gitlab.com%2Facme%2Fapp" });
    expect(checkRegisteredTree("/link/pool/app-1", deps)).toEqual({ ok: true, path: "/real/pool/app-1", repoName: "remote:gitlab.com%2Facme%2Fapp" });
  });
  test("refuses an unregistered directory, a relative path, a non-string and a missing path", () => {
    for (const bad of ["/real/other", "app", 3, undefined, "/nope/x"]) {
      const r = checkRegisteredTree(bad, deps);
      expect(r.ok, String(bad)).toBe(false);
    }
    expect((checkRegisteredTree("/real/other", deps) as { error: string }).error).toContain("registered");
  });
  test("a subdirectory of a registered tree is refused with a message naming the root", () => {
    const r = checkRegisteredTree("/link/app/src", deps);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("root");
    expect((r as { error: string }).error).toContain("registered");
  });
});

describe("checkRegisteredTree on a real filesystem", () => {
  test("a registry record stored at a symlink path accepts the tree by realpath; an alias to an unregistered directory is refused", () => {
    const root = mkdtempSync(join(tmpdir(), "tree-guard-"));
    try {
      const tree = join(root, "tree");
      const other = join(root, "other");
      mkdirSync(tree);
      mkdirSync(other);
      const treeLink = join(root, "tree-link");
      const otherLink = join(root, "other-link");
      symlinkSync(tree, treeLink);
      symlinkSync(other, otherLink);
      const byRepo = { "remote:example.com%2Facme%2Fapp": [{ name: "app-1", path: treeLink }] };
      const fsDeps: TreeGuardDeps = {
        repoIndex: () => ({}),
        treeByPath: (p) => findTreeByRealpath(p, byRepo, realpathSync),
        realpath: realpathSync,
        worktreeRoots: () => [],
      };
      expect(checkRegisteredTree(treeLink, fsDeps)).toEqual({ ok: true, path: realpathSync(tree), repoName: "remote:example.com%2Facme%2Fapp" });
      expect(checkRegisteredTree(tree, fsDeps)).toEqual({ ok: true, path: realpathSync(tree), repoName: "remote:example.com%2Facme%2Fapp" });
      expect(checkRegisteredTree(otherLink, fsDeps).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("findTreeByRealpath", () => {
  const realpath = (p: string) => {
    if (p === "/gone/app-2") throw new Error("ENOENT");
    return p.replace("/link/", "/real/");
  };
  const byRepo = {
    "remote:gitlab.com%2Facme%2Fapp": [
      { name: "app-1", path: "/link/pool/app-1" },
      { name: "app-2", path: "/gone/app-2" },
    ],
  };

  test("resolves an alias record to its realpath match", () => {
    expect(findTreeByRealpath("/real/pool/app-1", byRepo, realpath)).toEqual({
      repoName: "remote:gitlab.com%2Facme%2Fapp",
      tree: "app-1",
    });
  });

  test("skips a record whose path throws", () => {
    expect(findTreeByRealpath("/gone/app-2", byRepo, realpath)).toBeNull();
  });

  test("returns null when nothing matches", () => {
    expect(findTreeByRealpath("/real/pool/app-9", byRepo, realpath)).toBeNull();
  });
});

describe("checkRegisteredTree on a git worktree the registry never adopted", () => {
  const APP = "remote:gitlab.com%2Facme%2Fapp";
  const LIB = "remote:gitlab.com%2Facme%2Flib";
  const make = (asked: string[]): TreeGuardDeps => ({
    repoIndex: () => ({ [APP]: "/link/app", [LIB]: "/real/lib" }),
    treeByPath: (p) => (p === "/real/pool/app-1" ? { repoName: APP, tree: "app-1" } : null),
    realpath: (p) => { if (p.startsWith("/nope")) throw new Error("ENOENT"); return p.replace("/link/", "/real/"); },
    worktreeRoots: (checkout) => {
      asked.push(checkout);
      if (checkout === "/link/app") return ["/link/app", "/nope/pruned", "/link/app/.worktrees/nested", "/real/elsewhere/app-side"];
      if (checkout === "/real/lib") return ["/real/lib", "/real/lib/.worktrees/lib-wt"];
      return [];
    },
  });

  test("admits a worktree nested in its checkout, directly and through a symlink, as that checkout's repo", () => {
    const asked: string[] = [];
    const deps = make(asked);
    expect(checkRegisteredTree("/real/app/.worktrees/nested", deps)).toEqual({ ok: true, path: "/real/app/.worktrees/nested", repoName: APP });
    expect(checkRegisteredTree("/link/app/.worktrees/nested", deps)).toEqual({ ok: true, path: "/real/app/.worktrees/nested", repoName: APP });
  });

  test("admits a worktree outside its checkout and names the right repo when several are registered", () => {
    const deps = make([]);
    expect(checkRegisteredTree("/real/elsewhere/app-side", deps)).toEqual({ ok: true, path: "/real/elsewhere/app-side", repoName: APP });
    expect(checkRegisteredTree("/real/lib/.worktrees/lib-wt", deps)).toEqual({ ok: true, path: "/real/lib/.worktrees/lib-wt", repoName: LIB });
  });

  test("refuses a subdirectory of the nested worktree and of the checkout", () => {
    const deps = make([]);
    for (const bad of ["/real/app/.worktrees/nested/src", "/link/app/.worktrees/nested/src", "/real/app/src", "/real/app/.worktrees"]) {
      const r = checkRegisteredTree(bad, deps);
      expect(r.ok, bad).toBe(false);
      expect((r as { error: string }).error, bad).toContain("registered");
    }
  });

  test("lists worktrees only from registered checkouts, and only once the cheaper lookups miss", () => {
    const asked: string[] = [];
    const deps = make(asked);
    checkRegisteredTree("/link/app", deps);
    checkRegisteredTree("/link/pool/app-1", deps);
    expect(asked).toEqual([]);
    checkRegisteredTree("/real/app/.worktrees/nested/src", deps);
    expect(asked).toEqual(["/link/app", "/real/lib"]);
  });
});

describe("realTreeGuardDeps.worktreeRoots", () => {
  test("clears GIT_DIR from the inherited environment, so it lists the checkout it was asked about, not the repo GIT_DIR names", () => {
    // Resolve symlinks (macOS /var → /private/var) so paths match what
    // `git worktree list --porcelain` returns.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "tree-guard-envclear-")));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" });
    const prevGitDir = process.env.GIT_DIR;
    try {
      const repoA = join(root, "app-a");
      const repoB = join(root, "app-b");
      mkdirSync(repoA);
      mkdirSync(repoB);
      git(repoA, "init");
      git(repoA, "commit", "--allow-empty", "-m", "init");
      git(repoB, "init");
      git(repoB, "commit", "--allow-empty", "-m", "init");

      process.env.GIT_DIR = join(repoB, ".git");
      expect(realTreeGuardDeps.worktreeRoots(repoA)).toEqual([repoA]);
    } finally {
      if (prevGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prevGitDir;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("stops discovery at a checkout with no .git of its own, so it does not list an outer repo's worktrees", () => {
    // Resolve symlinks (macOS /var → /private/var) so paths match what
    // `git worktree list --porcelain` returns.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "tree-guard-ceiling-")));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" });
    try {
      const outer = join(root, "outer");
      mkdirSync(outer);
      git(outer, "init");
      git(outer, "commit", "--allow-empty", "-m", "init");
      git(outer, "worktree", "add", "-b", "feat/x", join(root, "outer-linked"));
      const subdir = join(outer, "subdir");
      mkdirSync(subdir);
      expect(realTreeGuardDeps.worktreeRoots(subdir)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("checkRegisteredTree against a real git worktree nested in its checkout", () => {
  test("admits the nested worktree by path, trailing slash and symlink; refuses subdirectories", () => {
    const root = mkdtempSync(join(tmpdir(), "tree-guard-git-"));
    try {
      const repo = join(root, "app");
      mkdirSync(repo);
      const git = (...args: string[]) =>
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], { cwd: repo, stdio: "pipe" });
      git("init");
      git("commit", "--allow-empty", "-m", "init");
      const nested = join(repo, ".worktrees", "nested");
      git("worktree", "add", "-b", "nested", nested);
      mkdirSync(join(nested, "sub"));
      mkdirSync(join(repo, "sub"));
      const link = join(root, "nested-link");
      symlinkSync(nested, link);
      const APP = "remote:example.com%2Facme%2Fapp";
      const fsDeps: TreeGuardDeps = { repoIndex: () => ({ [APP]: repo }), treeByPath: () => null, realpath: realpathSync, worktreeRoots: listWorktreeRoots };
      const admitted = { ok: true as const, path: realpathSync(nested), repoName: APP };
      expect(checkRegisteredTree(nested, fsDeps)).toEqual(admitted);
      expect(checkRegisteredTree(`${nested}/`, fsDeps)).toEqual(admitted);
      expect(checkRegisteredTree(link, fsDeps)).toEqual(admitted);
      expect(checkRegisteredTree(repo, fsDeps)).toEqual({ ok: true, path: realpathSync(repo), repoName: APP });
      expect(checkRegisteredTree(join(nested, "sub"), fsDeps).ok).toBe(false);
      expect(checkRegisteredTree(join(repo, "sub"), fsDeps).ok).toBe(false);
      expect(checkRegisteredTree(join(repo, ".worktrees"), fsDeps).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
