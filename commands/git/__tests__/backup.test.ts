import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { backupCommand, restoreCommand } from "../backup.ts";
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
