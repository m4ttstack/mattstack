/**
 * `rt settings set rt.hooks ... --repo <name>` only writes the store: rt's
 * git hook shim asks rt for the setting itself, so there is no cache to
 * regenerate.
 *
 * Exercises `settingsSet` directly rather than through a spawned CLI: its
 * happy path never calls `process.exit` (only argument-error branches do),
 * so it's safe to call in-process.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { repoDataDir } from "../../lib/rt-paths.ts";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import { settingsSet } from "../settings-keys.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const REMOTE = "git@gitlab.com:fake/hooks-regen-repo.git";

describe("rt settings set rt.hooks --repo", () => {
  const origHome = process.env.HOME;
  let home: string;
  let repoPath: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-hooks-regen-")));
    process.env.HOME = home;
    closeStateDb();
    repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-hooks-regen-repo-")));
    execSync("git init -q", { cwd: repoPath });
    execSync(`git remote add origin ${REMOTE}`, { cwd: repoPath });
    mkdirSync(join(repoPath, ".husky"));
    writeFileSync(join(repoPath, ".husky", "pre-commit"), "");
    setKvValue("repo-index", "hooks-regen-repo", repoPath);
  });

  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  test("a --repo write lands in the store and writes no hooks.json", async () => {
    const cap = captureOut();
    out.__test__.setHuman(() => false);
    try {
      await settingsSet(["rt.hooks", '{"enabled":false,"hooks":{}}', "--scope", "machine", "--repo", "hooks-regen-repo"]);
      expect(cap.stdout()).not.toContain("Hooks updated");
    } finally {
      cap.restore();
    }
    expect(existsSync(join(repoDataDir("hooks-regen-repo"), "hooks.json"))).toBe(false);
  });

  test("a write with no --repo is refused: rt.hooks is repo-only, so nothing is written", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit sentinel");
    });
    const cap = captureOut();
    out.__test__.setHuman(() => false);
    try {
      await expect(settingsSet(["rt.hooks", '{"enabled":false,"hooks":{}}', "--scope", "user"])).rejects.toThrow("process.exit sentinel");
      expect(cap.stderr()).toMatch(/repo-only/);
      expect(cap.stderr()).toStartWith("refusing to set");
      expect(cap.stderr()).not.toContain("[failed]");
    } finally {
      exitSpy.mockRestore();
      cap.restore();
    }
    expect(existsSync(join(repoDataDir("hooks-regen-repo"), "hooks.json"))).toBe(false);
  });
});
