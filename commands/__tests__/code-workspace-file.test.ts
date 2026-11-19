/**
 * The .code-workspace choice belongs to the repo, not the folder: pool
 * worktrees are provisioned per task and disposed after, so a choice keyed
 * by folder path is asked again in every new tree and left behind in every
 * disposed one. And only VS Code and its forks open a workspace file; any
 * other editor gets the folder.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { editorPrefKey, resolveWorkspaceSync, takesWorkspaceFile } from "../code.ts";

describe("takesWorkspaceFile", () => {
  test.each([
    "code", "cursor", "codium", "windsurf", "code -n",
    'open -a "Cursor"', 'open -a "Visual Studio Code"', 'open -a "Antigravity"',
    'open -a "Antigravity IDE"', 'open -a "Windsurf"', 'open -n -a "Cursor"',
    "open -a /Applications/Cursor.app",
  ])("%s opens a workspace file", (editor) => {
    expect(takesWorkspaceFile(editor)).toBe(true);
  });

  test.each(["zed", 'open -a "Zed"', 'open -n -a "Zed"', "subl", "idea", 'open -a "Sublime Text"'])(
    "%s gets the folder",
    (editor) => {
      expect(takesWorkspaceFile(editor)).toBe(false);
    },
  );
});

describe("resolveWorkspaceSync", () => {
  let root: string;
  let main: string;
  let pool: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt-code-ws-")));
    main = join(root, "main");
    pool = join(root, "pool");
    execSync(`git init -q "${main}"`, { stdio: "pipe" });
    execSync("git remote add origin https://github.com/acme/widgets.git", { cwd: main, stdio: "pipe" });
    execSync("git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init", { cwd: main, stdio: "pipe" });
    execSync(`git worktree add -q "${pool}"`, { cwd: main, stdio: "pipe" });
    for (const dir of [main, pool]) {
      writeFileSync(join(dir, "a.code-workspace"), "{}");
      writeFileSync(join(dir, "b.code-workspace"), "{}");
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("a choice saved for the repo applies in a fresh worktree", () => {
    const prefs = { editors: {}, workspaces: { [editorPrefKey(main)]: "b.code-workspace" } };

    expect(resolveWorkspaceSync(pool, prefs, "cursor")).toBe(join(pool, "b.code-workspace"));
  });

  test("a choice saved under the folder path before the cutover is still read", () => {
    const prefs = { editors: {}, workspaces: { [pool]: "a.code-workspace" } };

    expect(resolveWorkspaceSync(pool, prefs, "cursor")).toBe(join(pool, "a.code-workspace"));
  });

  test("two workspace files and no saved choice needs the picker", () => {
    expect(resolveWorkspaceSync(pool, { editors: {}, workspaces: {} }, "cursor")).toBeNull();
  });

  test("an editor that cannot open workspace files gets the folder, saved choice or not", () => {
    const prefs = { editors: {}, workspaces: { [editorPrefKey(main)]: "b.code-workspace" } };

    expect(resolveWorkspaceSync(pool, prefs, "zed")).toBe(pool);
    expect(resolveWorkspaceSync(pool, { editors: {}, workspaces: {} }, "zed")).toBe(pool);
  });
});
