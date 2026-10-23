import { describe, test, expect, beforeEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { disableFsmonitorForTree, fsmonitorOffInTree } from "../fsmonitor.ts";

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

  test("fsmonitorOffInTree reads the per-tree file without spawning git", async () => {
    expect(fsmonitorOffInTree(tree)).toBe(false);
    await disableFsmonitorForTree(repo, tree);
    expect(fsmonitorOffInTree(tree)).toBe(true);
  });

  test("applying twice is a no-op the second time", async () => {
    await disableFsmonitorForTree(repo, tree);
    const again = await disableFsmonitorForTree(repo, tree);
    expect(again).toEqual({ ok: true, enabledExtension: false });
    expect(sh("git config --worktree --get-all core.fsmonitor", tree)).toBe("false");
  });
});
