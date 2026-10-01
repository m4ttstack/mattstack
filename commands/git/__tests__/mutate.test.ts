import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as out from "../../../lib/ui/out.ts";
import { renderPlain } from "../../../lib/ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { stashApplyCommand, stashBlocks, stashDropCommand, stashPopCommand, stashPushCommand, tagBlocks, tagCreateCommand, tagDeleteCommand, UNDO_REFUSED } from "../mutate.ts";
import { exitCodeOf, inDir, makeRepo, trapExit } from "./helpers.ts";

test("the stash list names each stash by its number, its branch and its message", () => {
  expect(
    renderPlain(
      stashBlocks([
        { index: 0, branch: "feature/login", message: "WIP on feature/login: wip sample" },
        { index: 1, branch: null, message: "older" },
      ]),
    ),
  ).toBe("stash 0  feature/login  WIP on feature/login: wip sample\nstash 1  detached HEAD  older\n");
  expect(renderPlain(stashBlocks([]))).toBe("[skipped] No stashes\n");
});

test("the tag list names each tag, its commit and whether it is annotated", () => {
  expect(
    renderPlain(
      tagBlocks([
        { name: "v1.2.3", sha: "aaaaaaaaaaaaaaaa", annotated: true, targetSha: "0123456789abcdef" },
        { name: "nightly", sha: "fedcba9876543210", annotated: false, targetSha: "fedcba9876543210" },
      ]),
    ),
  ).toBe("v1.2.3   01234567  annotated\nnightly  fedcba98\n");
  expect(renderPlain(tagBlocks([]))).toBe("[skipped] No tags\n");
});

test("every reason undo refuses is a refused note in plain words", () => {
  expect(renderPlain(UNDO_REFUSED.pushed)).toBe("[refused] The last commit is already pushed\n  why: Undoing it here would leave this branch behind origin.\n");
  expect(renderPlain(UNDO_REFUSED.initial)).toBe("[refused] This is the first commit, so there is nothing to go back to\n");
  expect(renderPlain(UNDO_REFUSED.merge)).toBe("[refused] The last commit is a merge, and rt does not undo merges\n");
});
let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-mutate-")));
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

test("stash push, apply, pop and drop each say what happened, on stdout", async () => {
  await inDir(repo, () => stashPushCommand([]));
  writeFileSync(join(repo, "a.txt"), "stash me\n");
  await inDir(repo, () => stashPushCommand([]));
  await inDir(repo, () => stashApplyCommand([]));
  await inDir(repo, () => stashDropCommand(["0"]));
  expect(io.stdout()).toBe(
    "[skipped] Nothing to stash\n" +
      "[ok] Stashed your changes\n" +
      "[ok] Brought back stash 0  it is still in the list\n" +
      "[ok] Deleted stash 0\n",
  );
  expect(io.stderr()).toBe("");
});

test("stash pop says the stash left the list", async () => {
  writeFileSync(join(repo, "a.txt"), "stash me\n");
  await inDir(repo, () => stashPushCommand([]));
  io.clear();
  await inDir(repo, () => stashPopCommand([]));
  expect(io.stdout()).toBe("[ok] Brought back stash 0  and removed it from the list\n");
});

test("a value flag with nothing after it asks for the value", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashPushCommand(["--message"])))).toBe(1);
  expect(io.stderr()).toBe("That option needs a value after it\n  next: rt git stash push [--message <m>] [--include-untracked] [--json]\n");
  expect(io.stdout()).toBe("");
});

test("a stash index that is not a number is a usage failure on stderr, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashPopCommand(["x"])))).toBe(1);
  expect(io.stderr()).toBe("That is not a stash number\n  why: A stash is named by its number in the list, starting at 0.\n  next: rt git stash pop [<index>] [--json]\n");
  expect(io.stdout()).toBe("");
});

test("stash drop with no index off a terminal asks which stash", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashDropCommand([])))).toBe(1);
  expect(io.stderr()).toBe("Which stash?\n  next: rt git stash drop <index> [--json]\n");
});

test("tag create and delete say what happened; a missing name asks for one", async () => {
  await inDir(repo, () => tagCreateCommand(["v0.0.1-sample"]));
  await inDir(repo, () => tagDeleteCommand(["v0.0.1-sample"]));
  expect(io.stdout()).toBe("[ok] Created tag v0.0.1-sample\n[ok] Deleted tag v0.0.1-sample  on this Mac only\n");
  expect(await exitCodeOf(() => inDir(repo, () => tagCreateCommand([])))).toBe(1);
  expect(io.stderr()).toBe("What should the tag be called?\n  next: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]\n");
});

test("a tag git will not delete fails with a plain title over git's words", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => tagDeleteCommand(["no-such-tag"])))).toBe(1);
  expect(io.errLines()[0]).toBe("Could not delete that tag");
  expect(io.errLines().length).toBeGreaterThan(1);
});
