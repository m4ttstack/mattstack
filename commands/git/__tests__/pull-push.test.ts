import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { pullCommand } from "../pull.ts";
import { pushCommand, forcePushCommand, upstreamCommand } from "../push.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

/** `repo` on a branch named feature, with a bare origin that has main only. */
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-pull-push-")));
  repo = makeRepo(root);
  const origin = join(root, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "pipe" });
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "checkout", "-qb", "feature");
  io = captureOut({ console: true });
  out.__test__.reset();
  out.__test__.setHuman(() => false);
  exit = trapExit();
});
afterEach(() => {
  exit.restore();
  io.restore();
  rmSync(root, { recursive: true, force: true });
});

test("a pull dry run names the branch and the remote, then the command to copy", async () => {
  await pullCommand(["--dry-run"], ctxFor(repo));
  expect(io.stdout()).toBe("[skipped] Would pull feature from origin  dry run\nthe command:\ngit -c rebase.backend=merge pull --ff --recurse-submodules --progress origin\n");
  expect(io.stderr()).toBe("");
});

test("a pull with uncommitted changes is refused on stderr, exit 1", async () => {
  writeFileSync(join(repo, "a.txt"), "edited\n");
  expect(await exitCodeOf(() => pullCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("[refused] You have uncommitted changes\n  why: A pull could overwrite them.\n  next: Commit them, or set them aside with rt git stash push\n");
  expect(io.stdout()).toBe("");
});

test("a pull on a detached HEAD fails on stderr, exit 1", async () => {
  git(repo, "checkout", "-q", "--detach");
  expect(await exitCodeOf(() => pullCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("You are not on a branch\n  why: This needs a branch, and HEAD is detached right now.\n");
});

test("upstream says what it would do, does it, then says it is already right", async () => {
  await upstreamCommand(["--dry-run"], ctxFor(repo));
  await upstreamCommand([], ctxFor(repo));
  await upstreamCommand([], ctxFor(repo));
  expect(io.stdout()).toBe(
    "[skipped] Would point feature at origin/feature  it tracks nothing now\n" +
      "[ok] feature now tracks origin/feature  it tracked nothing\n" +
      "[ok] feature already tracks origin/feature\n",
  );
  expect(io.stderr()).toBe("");
});

test("a push dry run names where it would go, the upstream it would fix, and the command", async () => {
  expect(await pushCommand(["--dry-run"], ctxFor(repo))).toBe(true);
  expect(io.stdout()).toBe(
    "[skipped] Would push feature to origin/feature  dry run\n" +
      "  note: This branch tracks nothing. A real push points it at origin/feature.\n" +
      "the command:\n" +
      "git push -u origin feature\n",
  );
});

test("a forced dry run says so and shows the lease flag in the command", async () => {
  await forcePushCommand(["--dry-run"], ctxFor(repo));
  expect(io.lines()[0]).toBe("[skipped] Would push feature to origin/feature  dry run, forcing with a lease");
  expect(io.lines().at(-1)).toBe("git push --force-with-lease -u origin feature");
});

test("off a terminal a diverged branch fails with the command to run, exit 1", async () => {
  git(repo, "push", "-q", "-u", "origin", "feature");
  git(repo, "commit", "-q", "--amend", "-m", "first commit, reworded");
  expect(await exitCodeOf(() => pushCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe(
    "feature and origin/feature have diverged\n" +
      "  why: This usually follows a rebase or an amend, and a plain push would be rejected.\n" +
      "  next: rt git push force\n",
  );
  expect(io.stdout()).toBe("");
});
