import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { rebaseOnto } from "../rebase.ts";

let tmpRoot: string;
let savedSyncLogPath: string | undefined;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-rebase-")));
  // rebaseOnto logs every git command via syncLog; redirect it to a temp
  // file so these tests never append to the real ~/.mattstack/rt/sync.log.
  savedSyncLogPath = process.env.RT_SYNC_LOG_PATH;
  process.env.RT_SYNC_LOG_PATH = join(tmpRoot, "sync.log");
});

afterEach(() => {
  if (savedSyncLogPath === undefined) delete process.env.RT_SYNC_LOG_PATH;
  else process.env.RT_SYNC_LOG_PATH = savedSyncLogPath;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* */ }
});

function sh(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: "pipe" });
}

/**
 * Repo where `feature` and `master` both edit line 1 of app.txt,
 * guaranteeing an unresolvable conflict with no auto-resolve rules.
 */
function makeConflictRepo(): string {
  const repo = join(tmpRoot, "repo");
  execSync(`git init -q -b master "${repo}"`);
  const git = (c: string) => sh(`git -c user.email=t@t -c user.name=t ${c}`, repo);
  writeFileSync(join(repo, "app.txt"), "base\n");
  git("add .");
  git('commit -qm "base"');
  git("checkout -qb feature");
  writeFileSync(join(repo, "app.txt"), "feature change\n");
  git('commit -qam "feature edit"');
  git("checkout -q master");
  writeFileSync(join(repo, "app.txt"), "master change\n");
  git('commit -qam "master edit"');
  git("checkout -q feature");
  return repo;
}

function rebaseDirExists(repo: string): boolean {
  return (
    existsSync(join(repo, ".git", "rebase-merge")) ||
    existsSync(join(repo, ".git", "rebase-apply"))
  );
}

describe("rebaseOnto onConflict", () => {
  test("pause leaves the rebase in progress and reports it", async () => {
    const repo = makeConflictRepo();
    const result = await rebaseOnto({
      cwd: repo,
      target: "master",
      skipFetch: true,
      quiet: true,
      onConflict: "pause",
    });
    expect(result.status).toBe("conflict");
    expect(result.rebaseInProgress).toBe(true);
    expect(result.unresolvedFiles).toEqual(["app.txt"]);
    expect(result.backupBranch).toStartWith("rt-backup/rebase/feature/");
    expect(rebaseDirExists(repo)).toBe(true);
  });

  test("default aborts as before", async () => {
    const repo = makeConflictRepo();
    const result = await rebaseOnto({
      cwd: repo,
      target: "master",
      skipFetch: true,
      quiet: true,
    });
    expect(result.status).toBe("conflict");
    expect(result.rebaseInProgress).toBeFalsy();
    expect(rebaseDirExists(repo)).toBe(false);
  });
});

describe("rebaseOnto auto-resolve", () => {
  test("a conflicted file name holding shell syntax reaches git as one argument, and nothing runs", async () => {
    const hostile = "feat$(touch${IFS}pwned)";
    const repo = join(tmpRoot, "repo");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "pipe" });
    execFileSync("git", ["init", "-q", "-b", "master", repo], { stdio: "pipe" });
    writeFileSync(join(repo, hostile), "base\n");
    git("add", "--", hostile);
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feature");
    writeFileSync(join(repo, hostile), "feature change\n");
    git("commit", "-qam", "feature edit");
    git("checkout", "-q", "master");
    writeFileSync(join(repo, hostile), "master change\n");
    git("commit", "-qam", "master edit");
    git("checkout", "-q", "feature");

    const result = await rebaseOnto({
      cwd: repo,
      target: "master",
      skipFetch: true,
      quiet: true,
      autoResolve: [{ glob: "feat*", strategy: "theirs" }],
    });

    expect(existsSync(join(repo, "pwned"))).toBe(false);
    expect(existsSync(join(process.cwd(), "pwned"))).toBe(false);
    expect(result.status).toBe("ok");
    expect(result.resolvedFiles).toEqual([hostile]);
    expect(rebaseDirExists(repo)).toBe(false);
  });
});
