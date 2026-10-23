import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { isAbsolute, join } from "path";
import { disableFsmonitorForTree, ensureFsmonitorOffForTrees, fsmonitorOffInTree } from "../fsmonitor.ts";

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, shell: "/bin/zsh", encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A repo whose config says `core.fsmonitor = true`, plus one linked worktree. */
function makeRepoWithTree(): { repo: string; tree: string } {
  // realpathSync: git canonicalizes /var → /private/var on macOS (Global Constraints)
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rtfsm-")));
  const repo = join(root, "repo");
  const tree = join(root, "tree");
  execSync(`git init -q -b main ${repo}`, { shell: "/bin/zsh" });
  sh("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", repo);
  // The setting goes on after the add: with it on, the add itself consults a
  // fsmonitor daemon in the sandbox, which is the very hang under test.
  sh(`git worktree add -q -b work ${tree}`, repo);
  sh("git config core.fsmonitor true", repo);
  return { repo, tree };
}

describe("disableFsmonitorForTree", () => {
  let repo: string;
  let tree: string;
  beforeEach(() => { ({ repo, tree } = makeRepoWithTree()); });

  test("turns fsmonitor off in the tree and leaves the main checkout's value alone", async () => {
    const r = await disableFsmonitorForTree(repo, tree);
    expect(r).toEqual({ ok: true, enabledExtension: true });
    expect(sh("git config --get core.fsmonitor", tree)).toBe("false");
    expect(sh("git config --get core.fsmonitor", repo)).toBe("true");
    expect(sh("git config --get extensions.worktreeConfig", repo)).toBe("true");
  });

  test("a repo that already has the extension keeps it and reports no change to it", async () => {
    sh("git config extensions.worktreeConfig true", repo);
    const r = await disableFsmonitorForTree(repo, tree);
    expect(r).toEqual({ ok: true, enabledExtension: false });
    expect(sh("git config --get core.fsmonitor", tree)).toBe("false");
    expect(sh("git config --get core.fsmonitor", repo)).toBe("true");
  });

  test("refuses when the shared config carries core.worktree, writing nothing", async () => {
    sh("git config core.worktree .", repo);
    const r = await disableFsmonitorForTree(repo, tree);
    expect(r).toEqual({ ok: false, error: "worktree-config-blocked:core.worktree" });
    expect(sh("git config --get extensions.worktreeConfig || true", repo)).toBe("");
    expect(sh("git config --get core.fsmonitor", repo)).toBe("true");
  });

  test("refuses when the shared config says core.bare = true, writing nothing", async () => {
    sh("git config core.bare true", repo);
    const r = await disableFsmonitorForTree(repo, tree);
    expect(r).toEqual({ ok: false, error: "worktree-config-blocked:core.bare" });
    expect(sh("git config --get extensions.worktreeConfig || true", repo)).toBe("");
  });

  test("core.bare spelled 'yes' is still true", async () => {
    sh("git config core.bare yes", repo);
    const r = await disableFsmonitorForTree(repo, tree);
    expect(r).toEqual({ ok: false, error: "worktree-config-blocked:core.bare" });
  });

  test("with the extension already on, core.worktree in the shared config no longer blocks", async () => {
    sh("git config extensions.worktreeConfig true", repo);
    sh("git config core.worktree .", repo);
    const r = await disableFsmonitorForTree(repo, tree);
    expect(r).toEqual({ ok: true, enabledExtension: false });
    expect(sh("git config --get core.fsmonitor", tree)).toBe("false");
  });

  test("a global extensions.worktreeConfig does not count: the repo's own config gets it", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rtfsm-home-")));
    const env = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, ".gitconfig") };
    execSync("git config --global extensions.worktreeConfig true", { env, shell: "/bin/zsh" });
    const prior = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = env.GIT_CONFIG_GLOBAL;
    try {
      const r = await disableFsmonitorForTree(repo, tree);
      expect(r).toEqual({ ok: true, enabledExtension: true });
      expect(sh("git config --local --get extensions.worktreeConfig", repo)).toBe("true");
      expect(sh("git config --get core.fsmonitor", tree)).toBe("false");
    } finally {
      if (prior === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = prior;
    }
  });

  test("fsmonitorOffInTree reads the per-tree file without spawning git", async () => {
    expect(fsmonitorOffInTree(tree)).toBe(false);
    await disableFsmonitorForTree(repo, tree);
    expect(fsmonitorOffInTree(tree)).toBe(true);
  });

  test("fsmonitorOffInTree reads config.worktree the way git does: any case, last value wins", async () => {
    await disableFsmonitorForTree(repo, tree);
    const file = sh("git rev-parse --git-path config.worktree", tree);
    const abs = isAbsolute(file) ? file : join(tree, file);
    writeFileSync(abs, "[Core]\n\tFSMonitor = FALSE\n");
    expect(fsmonitorOffInTree(tree)).toBe(true);
    writeFileSync(abs, "[core]\n\tfsmonitor = false\n\tfsmonitor = true\n");
    expect(fsmonitorOffInTree(tree)).toBe(false);
  });

  test("the reconcile step skips creating rows and paths with no gitdir pointer, and warns once per tree", async () => {
    const plainDir = join(repo, "..", "not-a-worktree");
    mkdirSync(plainDir, { recursive: true });
    const warns: unknown[] = [];
    const log = { warn: (...args: unknown[]) => { warns.push(args); }, info: () => {} };
    const now = new Date().toISOString();
    const rows = [
      { name: "plain", path: plainDir, kind: "ephemeral", state: "on-deck", branch: "x", createdAt: now },
      { name: "mid-create", path: tree, kind: "ephemeral", state: "creating", branch: "work", createdAt: now },
      { name: "main", path: repo, kind: "main", branch: "main", createdAt: now },
    ] as const;
    await ensureFsmonitorOffForTrees("r", repo, rows as unknown as Parameters<typeof ensureFsmonitorOffForTrees>[2], log);
    expect(warns).toHaveLength(0);
    expect(fsmonitorOffInTree(tree)).toBe(false);
    expect(sh("git config --get core.fsmonitor", repo)).toBe("true");
  });

  test("applying twice is a no-op the second time", async () => {
    await disableFsmonitorForTree(repo, tree);
    const again = await disableFsmonitorForTree(repo, tree);
    expect(again).toEqual({ ok: true, enabledExtension: false });
    expect(sh("git config --worktree --get-all core.fsmonitor", tree)).toBe("false");
  });
});
