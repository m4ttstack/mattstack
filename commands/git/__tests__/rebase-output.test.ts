import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { conflictFailure, ontoCommand, rebaseCommand, rebaseOnto } from "../rebase.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let io: CapturedOut;
let exit: { restore(): void };
let savedSyncLogPath: string | undefined;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-rebase-out-")));
  savedSyncLogPath = process.env.RT_SYNC_LOG_PATH;
  process.env.RT_SYNC_LOG_PATH = join(root, "sync.log");
  io = captureOut({ console: true });
  out.__test__.reset();
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  if (savedSyncLogPath === undefined) delete process.env.RT_SYNC_LOG_PATH;
  else process.env.RT_SYNC_LOG_PATH = savedSyncLogPath;
  rmSync(root, { recursive: true, force: true });
});

/** `feature` and `main` both rewrite a.txt, so the rebase cannot resolve by itself. */
function conflictRepo(): string {
  const repo = makeRepo(root);
  git(repo, "checkout", "-qb", "feature");
  writeFileSync(join(repo, "a.txt"), "feature change\n");
  git(repo, "commit", "-qam", "feature edit");
  git(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "a.txt"), "main change\n");
  git(repo, "commit", "-qam", "main edit");
  git(repo, "checkout", "-q", "feature");
  return repo;
}

/** `feature` adds its own file, so it rebases onto the moved `main` cleanly. */
function cleanRepo(): string {
  const repo = makeRepo(root);
  git(repo, "checkout", "-qb", "feature");
  writeFileSync(join(repo, "f.txt"), "feature\n");
  git(repo, "add", "f.txt");
  git(repo, "commit", "-qm", "feature file");
  git(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "m.txt"), "main\n");
  git(repo, "add", "m.txt");
  git(repo, "commit", "-qm", "main file");
  git(repo, "checkout", "-q", "feature");
  return repo;
}

test("a clean rebase says it saved a backup, what it is doing, and that it worked, on stdout", async () => {
  const repo = cleanRepo();
  const result = await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [] });
  expect(result.status).toBe("ok");
  expect(io.lines()[0]).toMatch(/^\[ok\] Saved a backup  rt-backup\/rebase\/feature\//);
  expect(io.lines().slice(1)).toEqual(["[running] Rebasing feature onto main  1 commit behind", "[ok] Rebased feature onto main"]);
  expect(io.stderr()).toBe("");
});

test("a paused conflict asks for the person and lists the files", async () => {
  const repo = conflictRepo();
  const result = await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [], onConflict: "pause" });
  expect(result.rebaseInProgress).toBe(true);
  expect(io.lines().slice(2)).toEqual(["[needs you] 1 file has conflicts rt cannot resolve  the rebase is paused", "a.txt"]);
  expect(io.stderr()).toBe("");
});

test("an undone conflict prints nothing of its own and hands the caller the failure", async () => {
  const repo = conflictRepo();
  const result = await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [] });
  expect(result.status).toBe("conflict");
  expect(result.error).toBeUndefined();
  expect(io.lines()).toHaveLength(2);
  expect(io.stderr()).toBe("");
  expect(result.failure?.title).toBe("The rebase stopped on conflicts in 1 file");
  expect(result.failure?.why).toBe("rt put the branch back the way it was.");
  expect(result.failure?.details).toMatch(/^a\.txt\nA backup is at rt-backup\/rebase\/feature\//);
});

test("conflictFailure counts the files and leaves the backup line out when there is none", () => {
  expect(conflictFailure({ unresolvedFiles: ["a.ts", "b.ts"], backupBranch: null })).toEqual({
    title: "The rebase stopped on conflicts in 2 files",
    why: "rt put the branch back the way it was.",
    details: "a.ts\nb.ts",
  });
});

test("quiet prints nothing on either stream", async () => {
  const repo = cleanRepo();
  await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [], quiet: true });
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("");
});

test("a dry run and an up-to-date branch each take one line", async () => {
  const repo = cleanRepo();
  git(repo, "branch", "old-main", "HEAD~1");
  await rebaseOnto({ cwd: repo, target: "main", skipFetch: true, autoResolve: [], dryRun: true });
  await rebaseOnto({ cwd: repo, target: "old-main", skipFetch: true, autoResolve: [] });
  expect(io.stdout()).toBe("[skipped] Would rebase feature onto main  1 commit behind\n[ok] feature is up to date with old-main\n");
});

test("rebasing the target branch onto itself is skipped in one line", async () => {
  const repo = cleanRepo();
  await rebaseOnto({ cwd: repo, target: "feature", skipFetch: true, autoResolve: [] });
  expect(io.stdout()).toBe("[skipped] feature is the default branch  nothing to rebase\n");
});

test("uncommitted changes come back as an error with a failure to print", async () => {
  const repo = cleanRepo();
  writeFileSync(join(repo, "f.txt"), "edited\n");
  const result = await rebaseOnto({ cwd: repo, target: "main", skipFetch: true });
  expect(result.status).toBe("error");
  expect(result.error).toBe("You have uncommitted changes");
  expect(result.failure?.why).toBe("A rebase that hits a conflict would lose them.");
  expect(result.refused).toBe(true);
  expect(io.stdout()).toBe("");
});

test("rebase onto with no branch off a terminal asks which branch, exit 1", async () => {
  const repo = cleanRepo();
  expect(await exitCodeOf(() => ontoCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("Which branch?\n  why: This needs the branch to rebase onto.\n  next: rt git rebase onto <branch>\n");
  expect(io.stdout()).toBe("");
});

test("the handler draws the uncommitted-changes guard as a refused note on stderr, exit 1", async () => {
  const repo = cleanRepo();
  writeFileSync(join(repo, "f.txt"), "edited\n");
  expect(await exitCodeOf(() => ontoCommand(["main"], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("[refused] You have uncommitted changes\n  why: A rebase that hits a conflict would lose them.\n  next: Commit them, or set them aside with rt git stash push\n");
});

test("the handler draws any other error result as a failure on stderr, exit 1", async () => {
  const repo = cleanRepo();
  git(repo, "checkout", "-q", "--detach");
  expect(await exitCodeOf(() => ontoCommand(["main"], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("You are not on a branch\n  why: This needs a branch, and HEAD is detached right now.\n");
});

test("rebase --json keeps stdout for the bundle alone", async () => {
  const repo = makeRepo(root);
  const origin = join(root, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  git(repo, "checkout", "-qb", "feature");
  expect(await exitCodeOf(() => rebaseCommand(["--json"], ctxFor(repo)))).toBeNull();
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("[ok] Fetched from origin\n");
});
