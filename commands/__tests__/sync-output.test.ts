import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../lib/ui/out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import type { StackGuardRunners, StackRefusal } from "../../lib/stack-guard.ts";
import { conflictFailure } from "../git/rebase.ts";
import { BRANCH_GAP, branchEnding, compactFailure, reportSync, syncAllBlocks, syncAllExitCode, syncBranch, syncCommand, type SyncSummary } from "../sync.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "../git/__tests__/helpers.ts";

const refusal: StackRefusal = {
  kind: "stack-refusal",
  branch: "feature",
  source: "gitq",
  stack: { name: "s1", root: "master", parent: "master", children: [] },
  mrs: null,
  tool: "gitq sync --stack s1",
  hint: "feature is in stack s1, so changing it on its own would break the stack",
};

const summary = (over: Partial<SyncSummary>): SyncSummary => ({ branch: "feature", worktree: "/tmp/sample-app", resetResult: null, rebaseResult: null, pushed: false, ...over });

let io: CapturedOut;

beforeEach(() => {
  io = captureOut({ console: true });
  out.__test__.reset();
  out.__test__.setHuman(() => false);
});
afterEach(() => {
  io.restore();
});

describe("reportSync under --json", () => {
  test("a stack refusal is the refusal on stdout, two-space indented, and the code is 4", () => {
    expect(reportSync(summary({ error: "refused", refusal }), true)).toBe(4);
    expect(io.stdout()).toBe(JSON.stringify(refusal, null, 2) + "\n");
    expect(io.stderr()).toBe("");
  });

  test("a sync that worked prints nothing and the code is 0", () => {
    expect(reportSync(summary({ pushed: true }), true)).toBe(0);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });
});

// lib/mcp/__tests__/git-tools.test.ts feeds this same text to branch_sync and
// pins the error an agent reads; change one and the other must follow.
const REFUSED_STDERR =
  "[refused] You have uncommitted changes\n" +
  "  why: Syncing rewrites the branch, and a conflict would lose them.\n" +
  "  next: Commit them, or set them aside with rt git stash push\n";

const uncommitted = {
  title: "You have uncommitted changes",
  why: "Syncing rewrites the branch, and a conflict would lose them.",
  next: ["Commit them, or set them aside with ", out.cmd("rt git stash push")],
};

const fetchFailed = { title: "Could not fetch from origin", details: "fatal: unable to reach the remote" };

describe("how a sync ends", () => {
  test("under --json the uncommitted-changes guard is a refused note on stderr, stdout empty, code 1", () => {
    expect(reportSync(summary({ error: uncommitted.title, failure: uncommitted, refused: true }), true)).toBe(1);
    expect(io.stderr()).toBe(REFUSED_STDERR);
    expect(io.stdout()).toBe("");
  });

  test("a person reads the same refused note, never a failure block", () => {
    expect(reportSync(summary({ error: uncommitted.title, failure: uncommitted, refused: true }), false)).toBe(1);
    expect(io.stderr()).toBe(REFUSED_STDERR);
  });

  test("under --json a failure is at most three lines, with git's own line beside the title", () => {
    const failure = { title: "Could not fetch from origin", details: "Command failed: git fetch origin\nfatal: unable to reach the remote\nhint: check the network" };
    expect(compactFailure(failure)).toEqual({ title: "Could not fetch from origin", hint: "fatal: unable to reach the remote" });
    reportSync(summary({ error: failure.title, failure }), true);
    expect(io.stderr()).toBe("Could not fetch from origin  fatal: unable to reach the remote\n");
  });

  test("compactFailure takes the last detail line when git names no fatal or error line, and keeps why and next", () => {
    expect(compactFailure({ title: "The rebase stopped on conflicts in 2 files", why: "rt put the branch back the way it was.", details: "a.ts\nb.ts\nA backup is at rt-backup/rebase/feature/2026-09-30T10-00-00" })).toEqual({
      title: "The rebase stopped on conflicts in 2 files",
      hint: "A backup is at rt-backup/rebase/feature/2026-09-30T10-00-00",
      why: "rt put the branch back the way it was.",
    });
    expect(compactFailure(uncommitted)).toEqual(uncommitted);
  });

  test("a rejected push keeps git's line that says why, not the generic error under it", () => {
    const failure = {
      title: "Could not push feature",
      details: "Command failed: git push --force-with-lease origin feature\nTo /tmp/origin.git\n ! [rejected]        feature -> feature (stale info)\nerror: failed to push some refs to '/tmp/origin.git'",
    };
    expect(compactFailure(failure)).toEqual({ title: "Could not push feature", hint: "! [rejected] feature -> feature (stale info)" });
  });

  test("a person gets the whole failure, details included", () => {
    const failure = { title: "Could not fetch from origin", details: "Command failed: git fetch origin\nfatal: unable to reach the remote" };
    expect(reportSync(summary({ error: failure.title, failure }), false)).toBe(1);
    expect(io.stderr()).toBe("Could not fetch from origin\n  Command failed: git fetch origin\n  fatal: unable to reach the remote\n");
  });

  test("a person reads a stack refusal as a refused note with the tool to run, code 4", () => {
    expect(reportSync(summary({ error: "refused", refusal }), false)).toBe(4);
    expect(io.stderr()).toBe(
      "[refused] rt will not sync feature on its own\n" +
        "  why: feature is in stack s1, so changing it on its own would break the stack\n" +
        "  next: gitq sync --stack s1\n",
    );
    expect(io.stdout()).toBe("");
  });
});

describe("sync all's summary", () => {
  const ok = (branch: string, over: Partial<SyncSummary> = {}): SyncSummary => summary({ branch, ...over });
  const upToDate = { status: "up-to-date" as const, branch: "b", target: "origin/main", commitsBehind: 0, resolvedFiles: [], unresolvedFiles: [], postResolveSteps: [], backupBranch: null };
  const stacked = { ...refusal, branch: "feature/stacked" };

  test("counts what was pushed, what was current, and names each failure", () => {
    const blocks = syncAllBlocks([ok("feature/a", { pushed: true }), ok("feature/b", { rebaseResult: upToDate }), ok("feature/login", { error: fetchFailed.title, failure: fetchFailed })]);
    expect(renderPlain(blocks)).toBe("[failed] 2 of 3 branches synced  1 pushed, 1 up to date, 1 failed\nfeature/login  failed  Could not fetch from origin\n");
  });

  test("a stack member and the uncommitted-changes guard are counted as refused, not failed", () => {
    expect(renderPlain(syncAllBlocks([ok("feature/a", { pushed: true }), ok("feature/stacked", { error: "refused", refusal: stacked })]))).toBe(
      "[refused] 1 of 2 branches synced  1 pushed, 0 up to date, 1 refused\nfeature/stacked  refused  it is part of a stack\n",
    );
    expect(
      renderPlain(
        syncAllBlocks([
          ok("feature/a", { pushed: true }),
          ok("feature/stacked", { error: "refused", refusal: stacked }),
          ok("feature/dirty", { error: uncommitted.title, failure: uncommitted, refused: true }),
          ok("feature/login", { error: fetchFailed.title, failure: fetchFailed }),
        ]),
      ),
    ).toBe(
      "[failed] 1 of 4 branches synced  1 pushed, 0 up to date, 2 refused, 1 failed\n" +
        "feature/stacked  refused  it is part of a stack\n" +
        "feature/dirty    refused  You have uncommitted changes\n" +
        "feature/login    failed   Could not fetch from origin\n",
    );
  });

  test("with no failure it is one done line", () => {
    expect(renderPlain(syncAllBlocks([ok("feature/a", { pushed: true })]))).toBe("[ok] 1 of 1 branch synced  1 pushed, 0 up to date\n");
  });

  test("the exit code is 1 when any branch failed or was refused, else 0", () => {
    expect(syncAllExitCode([ok("feature/a", { pushed: true }), ok("feature/b", { rebaseResult: upToDate })])).toBe(0);
    expect(syncAllExitCode([ok("feature/a", { pushed: true }), ok("feature/stacked", { error: "refused", refusal: stacked })])).toBe(1);
    expect(syncAllExitCode([ok("feature/a"), ok("feature/dirty", { error: uncommitted.title, failure: uncommitted, refused: true })])).toBe(1);
    expect(syncAllExitCode([ok("feature/a"), ok("feature/login", { error: fetchFailed.title, failure: fetchFailed })])).toBe(1);
  });
});

describe("what sync all prints under a branch once its sync ends", () => {
  const conflict = (over: Partial<NonNullable<SyncSummary["rebaseResult"]>> = {}) => ({ status: "conflict" as const, branch: "feature", target: "origin/main", commitsBehind: 1, resolvedFiles: [], unresolvedFiles: ["a.txt"], postResolveSteps: [], backupBranch: "rt-backup/rebase/feature/2026-09-30T10-00-00", ...over });
  const conflictOutput = "The rebase stopped on conflicts in 1 file\n  why: rt put the branch back the way it was. Your branch as it was is saved as rt-backup/rebase/feature/2026-09-30T10-00-00.\n";

  test("a conflict that was undone shows its files under a caption and its backup in why", () => {
    const rebaseResult = conflict();
    const failure = conflictFailure(rebaseResult);
    const s = summary({ error: failure.title, failure, rebaseResult });
    expect(renderPlain(branchEnding(s))).toBe(conflictOutput + "files with conflicts:\n  a.txt\n");
    expect(reportSync(s, false)).toBe(1);
    expect(io.stderr()).toBe(conflictOutput + "files with conflicts:\n  a.txt\n");
    expect(io.stdout()).toBe("");
  });

  test("under --json an undone conflict has no file list and keeps the backup in the stderr tail", () => {
    const rebaseResult = conflict();
    const failure = conflictFailure(rebaseResult);
    expect(compactFailure(failure)).toEqual({ title: failure.title, why: failure.why });
    expect(reportSync(summary({ error: failure.title, failure, rebaseResult }), true)).toBe(1);
    expect(io.stderr()).toBe(conflictOutput);
    expect(io.stdout()).toBe("");
  });

  test("paused conflicts and empty file lists add no files block", () => {
    for (const rebaseResult of [conflict({ rebaseInProgress: true }), conflict({ unresolvedFiles: [] })]) {
      const failure = { title: "The rebase stopped" };
      const s = summary({ error: failure.title, failure, rebaseResult });
      expect(branchEnding(s)).toEqual([out.failure(failure)]);
      expect(reportSync(s, false)).toBe(1);
    }
    expect(io.stderr()).toBe("The rebase stopped\n[failed] The rebase stopped\n");
  });

  test("a stack member and the uncommitted-changes guard are refused notes; an error with no failure is its own title; a sync that worked prints nothing", () => {
    expect(renderPlain(branchEnding(summary({ error: "refused", refusal })))).toBe(
      "[refused] rt will not sync feature on its own\n  why: feature is in stack s1, so changing it on its own would break the stack\n  next: gitq sync --stack s1\n",
    );
    expect(renderPlain(branchEnding(summary({ error: uncommitted.title, failure: uncommitted, refused: true })))).toBe(REFUSED_STDERR);
    expect(renderPlain(branchEnding(summary({ error: "rt could not tell which repo this worktree belongs to" })))).toBe("rt could not tell which repo this worktree belongs to\n");
    expect(branchEnding(summary({ pushed: true }))).toEqual([]);
  });

  test("the blank row between branches is one empty line", () => {
    expect(renderPlain([BRANCH_GAP])).toBe("\n");
  });
});

describe("what a sync prints on the way", () => {
  let root: string;
  let exit: { restore(): void };
  let savedSyncLogPath: string | undefined;

  const forgeDown: StackGuardRunners = {
    gitqStacks: async () => null,
    forgeOpenMrs: async () => ({ ok: false, error: "forge: not logged in" }),
  };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "rt-sync-out-")));
    savedSyncLogPath = process.env.RT_SYNC_LOG_PATH;
    process.env.RT_SYNC_LOG_PATH = join(root, "sync.log");
    exit = trapExit();
  });
  afterEach(() => {
    exit.restore();
    if (savedSyncLogPath === undefined) delete process.env.RT_SYNC_LOG_PATH;
    else process.env.RT_SYNC_LOG_PATH = savedSyncLogPath;
    rmSync(root, { recursive: true, force: true });
  });

  /** A clone on `feature`, pushed, whose origin/main has moved on by one commit. */
  function staleClone(): string {
    const seed = makeRepo(root, "seed");
    const origin = join(root, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");
    const clone = join(root, "clone");
    execFileSync("git", ["clone", "-q", origin, clone], { stdio: "pipe" });
    git(clone, "config", "user.email", "sam@example.test");
    git(clone, "config", "user.name", "Sam Sample");
    git(clone, "checkout", "-qb", "feature");
    writeFileSync(join(clone, "f.txt"), "feature\n");
    git(clone, "add", "f.txt");
    git(clone, "commit", "-qm", "feature file");
    git(clone, "push", "-q", "-u", "origin", "feature");
    writeFileSync(join(seed, "m.txt"), "main\n");
    git(seed, "add", "m.txt");
    git(seed, "commit", "-qm", "main file");
    git(seed, "push", "-q", "origin", "main");
    return clone;
  }

  test("an unverified stack warns, then the fetch and the dry run each take a line, all on stdout", async () => {
    const clone = staleClone();
    const result = await syncBranch(clone, { dryRun: true, stackRunners: forgeDown, strictStackCheck: false });
    expect(result.error).toBeUndefined();
    expect(io.lines().slice(0, 4)).toEqual([
      "[warning] rt could not check whether this branch is part of a stack  syncing anyway",
      "  why: rt could not list the open merge requests, so it cannot tell whether this branch is in a stack (forge: not logged in)",
      "[ok] Fetched from origin",
      "[skipped] Would rebase feature onto origin/main  1 commit behind",
    ]);
    expect(io.stderr()).toBe("");
  });

  test("a branch name holding shell syntax is fetched, rebased and pushed as it is, and nothing runs", async () => {
    const hostile = "feat$(touch${IFS}pwned)";
    const clone = staleClone();
    git(clone, "checkout", "-qb", hostile);
    git(clone, "push", "-q", "-u", "origin", hostile);
    const result = await syncBranch(clone, { quiet: true, stackRunners: forgeDown, strictStackCheck: false });
    expect(existsSync(join(clone, "pwned"))).toBe(false);
    expect(existsSync(join(process.cwd(), "pwned"))).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.pushed).toBe(true);
    expect(git(clone, "rev-parse", `origin/${hostile}`)).toBe(git(clone, "rev-parse", "HEAD"));
  });

  test("a failed fetch draws one failure, and git's own words print once, in it", async () => {
    const clone = staleClone();
    git(clone, "remote", "set-url", "origin", join(root, "gone.git"));
    const result = await syncBranch(clone, { stackRunners: forgeDown, strictStackCheck: false });
    expect(reportSync(result, false)).toBe(1);
    expect(io.stdout()).not.toContain("[failed]");
    expect(io.stderr()).toStartWith("Could not fetch from origin\n  Command failed: git fetch origin\n");
    expect((io.stdout() + io.stderr()).split("Could not fetch").length - 1).toBe(1);
    expect((io.stdout() + io.stderr()).split("Command failed").length - 1).toBe(1);
  });

  test("a failed push draws one failure, and git's own words print once, in it", async () => {
    const clone = staleClone();
    writeFileSync(join(clone, ".git", "hooks", "pre-push"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = await syncBranch(clone, { stackRunners: forgeDown, strictStackCheck: false });
    expect(reportSync(result, false)).toBe(1);
    expect(io.stdout()).not.toContain("[failed]");
    expect(io.stderr()).toStartWith("Could not push feature\n  Command failed: git push --force-with-lease origin feature\n");
    expect((io.stdout() + io.stderr()).split("Could not push").length - 1).toBe(1);
    expect((io.stdout() + io.stderr()).split("failed to push some refs").length - 1).toBe(1);
  });

  test("quiet prints nothing on either stream", async () => {
    const clone = staleClone();
    await syncBranch(clone, { dryRun: true, quiet: true, stackRunners: forgeDown, strictStackCheck: false });
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("");
  });

  test("uncommitted changes come back as a refusal and print nothing", async () => {
    const clone = staleClone();
    writeFileSync(join(clone, "f.txt"), "edited\n");
    const result = await syncBranch(clone, { stackRunners: forgeDown });
    expect(result.error).toBe("You have uncommitted changes");
    expect(result.failure).toEqual(uncommitted);
    expect(result.refused).toBe(true);
    expect(io.stdout()).toBe("");
  });

  test("a repo with no origin says so on stdout, and that is not a failure", async () => {
    const repo = makeRepo(root);
    expect(await exitCodeOf(() => syncCommand([], ctxFor(repo)))).toBeNull();
    expect(io.stdout()).toBe("[skipped] This repo has no origin, so there is nothing to sync\n  next: Add one with git remote add origin <url>\n");
    expect(io.stderr()).toBe("");
  });

  test("under --json that note goes to stderr and stdout stays empty", async () => {
    const repo = makeRepo(root);
    expect(await exitCodeOf(() => syncCommand(["--json"], ctxFor(repo)))).toBeNull();
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("[skipped] This repo has no origin, so there is nothing to sync\n  next: Add one with git remote add origin <url>\n");
  });
});
