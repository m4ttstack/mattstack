import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { hardResetCommand, originCommand, resetToOrigin, softResetCommand } from "../reset.ts";
import { ctxFor, exitCodeOf, trapExit } from "./helpers.ts";

let tmpRoot: string;
let savedSyncLogPath: string | undefined;

beforeEach(() => {
  tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-reset-")));
  // resetToOrigin logs every git command via syncLog; redirect it to a temp
  // file so these tests never append to the real ~/.mattstack/rt/sync.log.
  savedSyncLogPath = process.env.RT_SYNC_LOG_PATH;
  process.env.RT_SYNC_LOG_PATH = join(tmpRoot, "sync.log");
});

afterEach(() => {
  if (savedSyncLogPath === undefined) delete process.env.RT_SYNC_LOG_PATH;
  else process.env.RT_SYNC_LOG_PATH = savedSyncLogPath;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* */ }
});

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function commit(repo: string, file: string, content: string, msg: string): void {
  writeFileSync(join(repo, file), content);
  sh(`git add "${file}"`, repo);
  sh(`git -c user.email=t@t -c user.name=t commit -qm "${msg}"`, repo);
}

/**
 * Bare origin with master + a pushed `feature` branch, master then advancing
 * past the feature fork point, and a clone sitting on `feature`. The starting
 * point for every divergence scenario below.
 */
function makeFixture(): { origin: string; local: string } {
  const origin = join(tmpRoot, "origin.git");
  const seed = join(tmpRoot, "seed");
  const local = join(tmpRoot, "local");

  sh(`git init -q --bare "${origin}"`, tmpRoot);
  sh(`git init -q -b master "${seed}"`, tmpRoot);
  sh(`git remote add origin "${origin}"`, seed);
  commit(seed, "base.txt", "base", "base");
  commit(seed, "m1.txt", "m1", "master 1");
  sh(`git push -q origin master`, seed);

  sh(`git checkout -qb feature`, seed);
  commit(seed, "f1.txt", "f1", "feature 1");
  commit(seed, "f2.txt", "f2", "feature 2");
  sh(`git push -q origin feature`, seed);

  sh(`git checkout -q master`, seed);
  for (let i = 2; i <= 5; i++) commit(seed, `m${i}.txt`, `m${i}`, `master ${i}`);
  sh(`git push -q origin master`, seed);

  sh(`git clone -q "${origin}" "${local}"`, tmpRoot);
  sh(`git checkout -q feature`, local);
  return { origin, local };
}

/** Second clone used to rewrite the remote branch out from under `local`. */
function rewriteRemoteFeature(origin: string, mutate: (helper: string) => void): void {
  const helper = join(tmpRoot, `helper-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  sh(`git clone -q "${origin}" "${helper}"`, tmpRoot);
  sh(`git checkout -q feature`, helper);
  mutate(helper);
  sh(`git push -qf origin feature`, helper);
}

describe("resetToOrigin divergence direction", () => {
  test("local rebased onto newer master → local-newer, HEAD untouched", async () => {
    const { local } = makeFixture();
    sh(`git -c user.email=t@t -c user.name=t rebase -q origin/master`, local);
    const headBefore = sh(`git rev-parse HEAD`, local);

    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });

    expect(result.status).toBe("local-newer");
    expect(result.cherryPicked).toEqual([]);
    expect(result.backupBranch).toBeNull();
    expect(sh(`git rev-parse HEAD`, local)).toBe(headBefore);
  });

  test("remote rebased onto newer master → reset to remote", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      sh(`git -c user.email=t@t -c user.name=t rebase -q origin/master`, helper);
    });
    sh(`git fetch -q origin`, local);

    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });

    expect(result.status).toBe("reset");
    expect(sh(`git rev-parse HEAD`, local)).toBe(sh(`git rev-parse origin/feature`, local));
  });

  test("remote rewritten on same base, extra local commit → reset + cherry-pick", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      sh(`git -c user.email=t@t -c user.name=t commit -q --amend -m "feature 2 (reworded)"`, helper);
    });
    commit(local, "f3.txt", "f3", "feature 3 local only");
    sh(`git fetch -q origin`, local);

    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });

    expect(result.status).toBe("cherry-picked");
    expect(result.cherryPicked).toHaveLength(1);
    expect(result.backupBranch).toStartWith("rt-backup/reset/feature/");
    expect(sh(`git log -1 --format=%s`, local)).toBe("feature 3 local only");
    expect(sh(`git log -1 --format=%s HEAD~1`, local)).toBe("feature 2 (reworded)");
  });

  test("in sync → no-op", async () => {
    const { local } = makeFixture();
    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });
    expect(result.status).toBe("in-sync");
  });

  test("local behind remote → fast-forward", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      commit(helper, "f3.txt", "f3", "feature 3");
    });
    sh(`git fetch -q origin`, local);

    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });

    expect(result.status).toBe("fast-forward");
    expect(sh(`git rev-parse HEAD`, local)).toBe(sh(`git rev-parse origin/feature`, local));
  });
});

describe("what a reset prints", () => {
  let io: CapturedOut;
  let exit: { restore(): void };

  beforeEach(() => {
    io = captureOut({ console: true });
    out.__test__.reset();
    out.__test__.setHuman(() => false);
    exit = trapExit();
  });
  afterEach(() => {
    exit.restore();
    io.restore();
  });

  test("in sync is one line on stdout", async () => {
    const { local } = makeFixture();
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("[ok] feature already matches origin/feature\n");
    expect(io.stderr()).toBe("");
  });

  test("a fast-forward is one line", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      commit(helper, "f3.txt", "f3", "feature 3");
    });
    sh(`git fetch -q origin`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("[ok] Caught feature up to origin/feature\n");
  });

  test("a branch rebased here onto a newer base is kept, and says why", async () => {
    const { local } = makeFixture();
    sh(`git -c user.email=t@t -c user.name=t rebase -q origin/master`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("[ok] Kept feature as it is  it is origin/feature rebased onto a newer origin/master\n");
  });

  test("a reset to a rebased origin names the backup, then the reset", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      sh(`git -c user.email=t@t -c user.name=t rebase -q origin/master`, helper);
    });
    sh(`git fetch -q origin`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.lines()[0]).toMatch(/^\[ok\] Saved a backup  rt-backup\/reset\/feature\//);
    expect(io.lines()[1]).toBe("[ok] Reset feature to origin/feature  origin was rebased");
    expect(io.lines()).toHaveLength(2);
  });

  test("extra local commits are listed, put back one by one, and counted", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      sh(`git -c user.email=t@t -c user.name=t commit -q --amend -m "feature 2 (reworded)"`, helper);
    });
    sh(`git config user.email t@t`, local);
    sh(`git config user.name t`, local);
    commit(local, "f3.txt", "f3", "feature 3 local only");
    sh(`git fetch -q origin`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    const lines = io.lines();
    expect(lines[1]).toBe("[warning] feature has 1 commit that origin does not");
    expect(lines[2]).toMatch(/^[0-9a-f]{7,} feature 3 local only$/);
    expect(lines[3]).toMatch(/^\[ok\] Put back [0-9a-f]{7,} feature 3 local only$/);
    expect(lines[4]).toBe("[ok] feature matches origin/feature  1 commit of yours put back on top");
    expect(lines).toHaveLength(5);
    expect(io.stderr()).toBe("");
  });

  test("quiet prints nothing on either stream", async () => {
    const { local } = makeFixture();
    await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });

  test("a branch origin does not have comes back with a failure that names the next command", async () => {
    const { local } = makeFixture();
    sh(`git checkout -qb not-pushed`, local);
    const result = await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(result.status).toBe("error");
    expect(result.error).toBe("not-pushed is not on origin yet");
    expect(result.failure).toEqual({ title: "not-pushed is not on origin yet", why: "There is nothing there to match.", next: { text: "rt git push", role: "command" } });
    expect(io.stdout()).toBe("");
  });

  test("reset origin draws the uncommitted-changes guard as a refused note on stderr, exit 1", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    expect(await exitCodeOf(() => originCommand([], ctxFor(local)))).toBe(1);
    expect(io.stderr()).toBe("[refused] You have uncommitted changes\n  why: Matching origin throws away local changes.\n  next: Commit them, or set them aside with rt git stash push\n");
    expect(io.stdout()).toBe("");
  });

  test("reset soft says the edits are kept", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    sh(`git add f1.txt`, local);
    await softResetCommand([], ctxFor(local));
    expect(io.stdout()).toBe("[ok] Unstaged everything  your edits are untouched\n");
  });

  test("reset hard names the backup of the branch, then what it threw away", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    await hardResetCommand([], ctxFor(local));
    expect(io.lines()[0]).toMatch(/^\[ok\] Saved a backup of the branch  rt-backup\/reset\/feature\//);
    expect(io.lines()[1]).toBe("[ok] Threw away every uncommitted change");
    expect(sh(`git status --porcelain`, local)).toBe("");
  });
});
