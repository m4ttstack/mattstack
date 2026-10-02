import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createGitClient } from "../../../packages/git-core/src/index.ts";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { amendCommand, stashDropCommand, stashListCommand, stashPopCommand, stashPushCommand, tagCreateCommand, tagDeleteCommand, tagListCommand, undoCommand } from "../mutate.ts";
import { exitCodeOf, git, inDir, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-mutate-json-")));
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

test("stash push, list and pop keep their envelopes", async () => {
  writeFileSync(join(repo, "a.txt"), "stash me\n");
  await inDir(repo, () => stashPushCommand(["--message", "wip sample", "--json"]));
  const listed = JSON.stringify({ ok: true, stashes: await createGitClient(repo).stashes() }) + "\n";
  await inDir(repo, () => stashListCommand(["--json"]));
  await inDir(repo, () => stashPopCommand(["--json"]));
  expect(io.stdout()).toBe('{"ok":true,"created":true}\n' + listed + '{"ok":true,"index":0}\n');
  expect(io.stderr()).toBe("");
});

test("stash push with nothing to stash is created false", async () => {
  await inDir(repo, () => stashPushCommand(["--json"]));
  expect(io.stdout()).toBe('{"ok":true,"created":false}\n');
});

test("stash drop with no index is the usage envelope, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashDropCommand(["--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git stash drop <index> [--json]"}\n');
  expect(io.stderr()).toBe("");
});

test("stash pop with a bad index is the usage envelope, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => stashPopCommand(["x", "--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git stash pop [<index>] [--json]"}\n');
});

test("tag create, list and delete keep their envelopes", async () => {
  await inDir(repo, () => tagCreateCommand(["v0.0.1-sample", "--message", "sample tag", "--json"]));
  const listed = JSON.stringify({ ok: true, tags: await createGitClient(repo).tags() }) + "\n";
  await inDir(repo, () => tagListCommand(["--json"]));
  await inDir(repo, () => tagDeleteCommand(["v0.0.1-sample", "--json"]));
  expect(io.stdout()).toBe('{"ok":true,"name":"v0.0.1-sample","pushed":false}\n' + listed + '{"ok":true,"name":"v0.0.1-sample"}\n');
  expect(io.stderr()).toBe("");
});

test("a flag is never taken as a tag name", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => tagCreateCommand(["-D", "--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]"}\n');
});

test("amend and undo on a branch another worktree holds keep the refused envelope, exit 1", async () => {
  const other = join(root, "other");
  git(repo, "worktree", "add", "-q", "-f", other, "main");
  const error = `refused: main is already checked out in another worktree at ${other}`;
  expect(await exitCodeOf(() => inDir(repo, () => amendCommand(["--json"])))).toBe(1);
  expect(await exitCodeOf(() => inDir(repo, () => undoCommand(["--json"])))).toBe(1);
  expect(io.stdout()).toBe(JSON.stringify({ ok: false, error }) + "\n" + JSON.stringify({ ok: false, error }) + "\n");
  expect(io.stderr()).toBe("");
});

test("when ownership cannot be checked, the warning goes to stderr and stdout keeps the envelope alone", async () => {
  writeFileSync(join(repo, "a.txt"), "amended\n");
  git(repo, "add", "a.txt");
  await inDir(repo, () => amendCommand(["--json"]));
  expect(io.lines().length).toBe(1);
  expect(JSON.parse(io.stdout()).ok).toBe(true);
  expect(io.errLines()[0]).toBe("[warning] rt could not check who owns this branch  going ahead");
  expect(io.errLines()[1]).toStartWith("  why: ");
});
