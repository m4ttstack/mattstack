import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { __testSeams, hardResetCommand, originCommand, resetToOrigin, softResetCommand } from "../reset.ts";
import { renderPlain } from "../../../lib/ui/out-plain.ts";
import type { ForgeTokenLookup } from "../../../lib/team/forge-token.ts";
import { createOriginAuth, tokenNoteBlocks, type OriginAuth, type OriginAuthSeams } from "../origin-auth.ts";
import type { FetchDeps } from "../shared.ts";


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
  }, 20_000);

  test("remote rebased onto newer master → reset to remote", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      sh(`git -c user.email=t@t -c user.name=t rebase -q origin/master`, helper);
    });
    sh(`git fetch -q origin`, local);

    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });

    expect(result.status).toBe("reset");
    expect(sh(`git rev-parse HEAD`, local)).toBe(sh(`git rev-parse origin/feature`, local));
  }, 20_000);

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
  }, 20_000);

  test("in sync → no-op", async () => {
    const { local } = makeFixture();
    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });
    expect(result.status).toBe("in-sync");
  }, 20_000);

  test("local behind remote → fast-forward", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      commit(helper, "f3.txt", "f3", "feature 3");
    });
    sh(`git fetch -q origin`, local);

    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });

    expect(result.status).toBe("fast-forward");
    expect(sh(`git rev-parse HEAD`, local)).toBe(sh(`git rev-parse origin/feature`, local));
  }, 20_000);
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
  }, 20_000);

  test("a fast-forward is one line", async () => {
    const { origin, local } = makeFixture();
    rewriteRemoteFeature(origin, (helper) => {
      commit(helper, "f3.txt", "f3", "feature 3");
    });
    sh(`git fetch -q origin`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("[ok] Caught feature up to origin/feature\n");
  }, 20_000);

  test("a branch rebased here onto a newer base is kept, and says why", async () => {
    const { local } = makeFixture();
    sh(`git -c user.email=t@t -c user.name=t rebase -q origin/master`, local);
    await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("[ok] Kept feature as it is  it is origin/feature rebased onto a newer origin/master\n");
  }, 20_000);

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
  }, 20_000);

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
    expect(lines[2]).toBe("commits:");
    expect(lines[3]).toMatch(/^  [0-9a-f]{7,} feature 3 local only$/);
    expect(lines[4]).toMatch(/^\[ok\] Put back [0-9a-f]{7,} feature 3 local only$/);
    expect(lines[5]).toBe("[ok] feature matches origin/feature  1 commit of yours put back on top");
    expect(lines).toHaveLength(6);
    expect(io.stderr()).toBe("");
  }, 20_000);

  test("quiet prints nothing on either stream", async () => {
    const { local } = makeFixture();
    await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true, skipFetch: true });
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  }, 20_000);

  test("a branch origin does not have comes back with a failure that names the next command", async () => {
    const { local } = makeFixture();
    sh(`git checkout -qb not-pushed`, local);
    const result = await resetToOrigin({ cwd: local, autoConfirm: true, skipFetch: true });
    expect(result.status).toBe("error");
    expect(result.error).toBe("not-pushed is not on origin yet");
    expect(result.failure).toEqual({ title: "not-pushed is not on origin yet", why: "There is nothing there to match.", next: { text: "rt git push", role: "command" } });
    expect(io.stdout()).toBe("");
  }, 20_000);

  test("reset origin draws the uncommitted-changes guard as a refused note on stderr, exit 1", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    expect(await exitCodeOf(() => originCommand([], ctxFor(local)))).toBe(1);
    expect(io.stderr()).toBe("[refused] You have uncommitted changes\n  why: Matching origin throws away local changes.\n  next: Commit them, or set them aside with rt git stash push\n");
    expect(io.stdout()).toBe("");
  }, 20_000);

  test("a branch name holding shell syntax reaches git as it is through a fetch, a patch-id compare and a cherry-pick, and nothing runs", async () => {
    const hostile = "feat$(touch${IFS}pwned)";
    const { origin, local } = makeFixture();
    const argv = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "pipe" });
    argv(local, "checkout", "-qb", hostile);
    argv(local, "push", "-q", "-u", "origin", hostile);
    const helper = join(tmpRoot, "hostile-helper");
    argv(tmpRoot, "clone", "-q", origin, helper);
    argv(helper, "checkout", "-q", hostile);
    argv(helper, "commit", "-q", "--amend", "-m", "feature 2 (reworded)");
    argv(helper, "push", "-qf", "origin", hostile);
    commit(local, "f3.txt", "f3", "feature 3 local only");

    const result = await resetToOrigin({ cwd: local, quiet: true, autoConfirm: true });

    expect(existsSync(join(local, "pwned"))).toBe(false);
    expect(existsSync(join(process.cwd(), "pwned"))).toBe(false);
    expect(result.status).toBe("cherry-picked");
    expect(result.branch).toBe(hostile);
    expect(sh(`git log -1 --format=%s`, local)).toBe("feature 3 local only");
  }, 20_000);

  test("reset origin on a branch name holding shell syntax says it already matches, and nothing runs", async () => {
    const hostile = "feat$(touch${IFS}pwned)";
    const { local } = makeFixture();
    execFileSync("git", ["checkout", "-qb", hostile], { cwd: local, stdio: "pipe" });
    execFileSync("git", ["push", "-q", "-u", "origin", hostile], { cwd: local, stdio: "pipe" });
    expect(await exitCodeOf(() => originCommand([], ctxFor(local)))).toBeNull();
    expect(existsSync(join(local, "pwned"))).toBe(false);
    expect(existsSync(join(process.cwd(), "pwned"))).toBe(false);
    expect(io.lines().at(-1)).toBe(`[ok] ${hostile} already matches origin/${hostile}`);
  }, 20_000);

  test("a failed fetch draws one failure, and git's own words print once, in it", async () => {
    const { local } = makeFixture();
    execFileSync("git", ["remote", "set-url", "origin", join(tmpRoot, "gone.git")], { cwd: local, stdio: "pipe" });
    expect(await exitCodeOf(() => originCommand([], ctxFor(local)))).toBe(1);
    expect(io.stdout()).toBe("");
    expect(io.stderr().split("Could not fetch").length - 1).toBe(1);
    expect(io.stderr()).toStartWith("Could not fetch from origin\n  Command failed: git fetch origin\n");
    expect(io.stderr().split("Command failed").length - 1).toBe(1);
  }, 20_000);

  test("reset soft says the edits are kept", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    sh(`git add f1.txt`, local);
    await softResetCommand([], ctxFor(local));
    expect(io.stdout()).toBe("[ok] Unstaged everything  your edits are untouched\n");
  }, 20_000);

  test("reset hard names the backup of the branch, then what it threw away", async () => {
    const { local } = makeFixture();
    writeFileSync(join(local, "f1.txt"), "edited");
    await hardResetCommand([], ctxFor(local));
    expect(io.lines()[0]).toMatch(/^\[ok\] Saved a backup of the branch  rt-backup\/reset\/feature\//);
    expect(io.lines()[1]).toBe("[ok] Threw away every uncommitted change");
    expect(sh(`git status --porcelain`, local)).toBe("");
  }, 20_000);
});

const TOKEN = "glpat-LEAKCHECK000000000";
const NO_USER = "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled";
const tokenSeams: OriginAuthSeams = { confirmedHost: () => null, lookup: async (): Promise<ForgeTokenLookup> => ({ kind: "token", token: TOKEN }) };

function fakeFetch(auth: OriginAuth, results: ({ ok: true } | { ok: false; output: string })[]): FetchDeps {
  return {
    run: async () => results.shift() ?? { ok: true },
    findAgent: async () => undefined,
    env: process.env,
    auth,
    helper: "!helper",
    switchViable: async () => false,
  };
}

describe("reset and the forge token", () => {
  let io: CapturedOut;
  let exit: { restore(): void };
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["GIT_TERMINAL_PROMPT", "GIT_ASKPASS"] as const;

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    io = captureOut({ console: true });
    out.__test__.reset();
    out.__test__.setHuman(() => false);
    exit = trapExit();
  });
  afterEach(() => {
    exit.restore();
    io.restore();
    delete __testSeams.originAuth;
    delete __testSeams.fetchDeps;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** feature already matches origin/feature, so no remote call follows the fetch. */
  function inSync(): string {
    const { local } = makeFixture();
    sh(`git remote set-url origin https://gitlab.com/acme/x.git`, local);
    return local;
  }

  test("resetToOrigin reports usedRtToken when its fetch needed rt's helper", async () => {
    const { local } = makeFixture();
    sh(`git remote set-url origin https://gitlab.com/acme/x.git`, local);
    sh(`git update-ref refs/remotes/origin/feature HEAD`, local);
    const auth = createOriginAuth(tokenSeams);
    const result = await resetToOrigin({ cwd: local, quiet: true, fetchDeps: fakeFetch(auth, [{ ok: false, output: NO_USER }, { ok: true }]), originAuth: auth });
    expect(result.status).toBe("in-sync");
    expect(result.usedRtToken).toBe(true);
    expect(result.tokenForge).toBe("gitlab");
    expect(JSON.stringify(result)).not.toContain("LEAKCHECK");
  }, 20_000);

  test("resetToOrigin with skipFetch never reports usedRtToken", async () => {
    const { local } = makeFixture();
    const result = await resetToOrigin({ cwd: local, quiet: true, skipFetch: true });
    expect(result.usedRtToken).toBeUndefined();
    expect(result.tokenForge).toBeUndefined();
  }, 20_000);

  test("originCommand prints the token note after a finished reset and not after a failure", async () => {
    const local = inSync();
    sh(`git update-ref refs/remotes/origin/feature HEAD`, local);
    const auth = createOriginAuth(tokenSeams);
    __testSeams.originAuth = createOriginAuth(null);
    __testSeams.fetchDeps = fakeFetch(auth, [{ ok: false, output: NO_USER }, { ok: true }]);
    expect(await exitCodeOf(() => originCommand([], ctxFor(local)))).toBeNull();
    expect(io.stderr() + io.stdout()).toContain(renderPlain(tokenNoteBlocks("gitlab")).split("\n")[0]!);
    expect(io.stderr() + io.stdout()).not.toContain("LEAKCHECK");

    io.restore();
    io = captureOut({ console: true });
    __testSeams.fetchDeps = fakeFetch(auth, [{ ok: false, output: "fatal: unable to access: Could not resolve host" }]);
    expect(await exitCodeOf(() => originCommand([], ctxFor(local)))).toBe(1);
    expect(io.stderr() + io.stdout()).not.toContain("GitLab token");
  }, 20_000);

  test("the command calls guardPrompts before the fetch and undoes it before exiting", async () => {
    const local = inSync();
    sh(`git update-ref refs/remotes/origin/feature HEAD`, local);
    const order: string[] = [];
    const auth: OriginAuth = {
      ...createOriginAuth(null),
      guardPrompts: async (_cwd, o) => {
        order.push(`guard push=${o?.push}`);
        return () => order.push("undo");
      },
    };
    const deps = fakeFetch(auth, []);
    deps.run = async () => (order.push("fetch"), { ok: true });
    __testSeams.originAuth = auth;
    __testSeams.fetchDeps = deps;
    await exitCodeOf(() => originCommand([], ctxFor(local)));
    expect(order).toEqual(["guard push=false", "fetch", "undo"]);
  }, 20_000);
});
