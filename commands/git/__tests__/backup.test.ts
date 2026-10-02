import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../../lib/ui/out-plain.ts";
import { backupCommand, restoreBlocks, restoreCommand } from "../backup.ts";
import { ctxFor, exitCodeOf, git, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-backup-")));
  repo = makeRepo(root);
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

test("backup says which branch it saved and where, on stdout", async () => {
  await backupCommand([], ctxFor(repo));
  expect(io.stdout()).toMatch(/^\[ok\] Backed up main  rt-backup\/manual\/main\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\n$/);
  expect(io.stderr()).toBe("");
});

test("backup on a detached HEAD is a failure on stderr, exit 1", async () => {
  git(repo, "checkout", "-q", "--detach");
  expect(await exitCodeOf(() => backupCommand([], ctxFor(repo)))).toBe(1);
  expect(io.stderr()).toBe("You are not on a branch\n  why: This needs a branch, and HEAD is detached right now.\n");
  expect(io.stdout()).toBe("");
});

test("restore with no backups says there is nothing to restore, and that is not a failure", async () => {
  expect(await exitCodeOf(() => restoreCommand([], ctxFor(repo)))).toBeNull();
  expect(io.stdout()).toBe("[skipped] There are no backups to restore\n");
  expect(io.stderr()).toBe("");
});

const backupOf = (originalBranch: string) => ({ ref: `rt-backup/rebase/${originalBranch}/2026-09-30T10-00-00`, operation: "rebase", originalBranch, timestamp: "2026-09-30T10-00-00", sha: "0123abcd" });

test("restoring a branch's own backup names that branch", () => {
  const { pending, done } = restoreBlocks("feature-a", backupOf("feature-a"), "2h ago");
  expect(renderPlain(pending)).toBe("[not yet] Restore feature-a to 0123abcd  rebase backup from 2h ago\n  note: This throws away every change made since that backup.\n");
  expect(renderPlain([done])).toBe("[ok] Restored feature-a  rt-backup/rebase/feature-a/2026-09-30T10-00-00\n");
});

test("restoring another branch's backup names the branch that is reset, and what it loses", () => {
  const { pending, done } = restoreBlocks("feature-b", backupOf("feature-a"), "2h ago");
  expect(renderPlain(pending)).toBe(
    "[not yet] Reset feature-b to feature-a's backup 0123abcd  rebase backup from 2h ago\n" +
      "  note: This replaces feature-b with that backup, and throws away every commit and change on feature-b that is not in it.\n",
  );
  expect(renderPlain([done])).toBe("[ok] Reset feature-b to feature-a's backup  rt-backup/rebase/feature-a/2026-09-30T10-00-00\n");
});

test("restoring onto a detached HEAD says detached HEAD", () => {
  const { pending, done } = restoreBlocks(null, backupOf("feature-a"), "2h ago");
  expect(renderPlain(pending).split("\n")[0]).toBe("[not yet] Reset detached HEAD to feature-a's backup 0123abcd  rebase backup from 2h ago");
  expect(renderPlain(pending)).toContain("  note: This moves HEAD to that backup, and throws away every change here that is not in it.\n");
  expect(renderPlain([done])).toBe("[ok] Reset detached HEAD to feature-a's backup  rt-backup/rebase/feature-a/2026-09-30T10-00-00\n");
});
