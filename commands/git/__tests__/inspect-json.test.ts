import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createGitClient } from "../../../packages/git-core/src/index.ts";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { branchesCommand, diffCommand, logCommand, statusCommand } from "../inspect.ts";
import { exitCodeOf, inDir, makeRepo, trapExit } from "./helpers.ts";

let root: string;
let repo: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-inspect-json-")));
  repo = makeRepo(root);
  writeFileSync(join(repo, "a.txt"), "two\n");
  writeFileSync(join(repo, "new.txt"), "hello\n");
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

test("status --json is the snapshot under ok, one line", async () => {
  await inDir(repo, () => statusCommand(["--json"]));
  expect(io.stdout()).toBe(JSON.stringify({ ok: true, ...(await createGitClient(repo).snapshot()) }) + "\n");
  expect(io.stderr()).toBe("");
});

test("log --json is the entries under ok", async () => {
  await inDir(repo, () => logCommand(["--json"]));
  expect(io.stdout()).toBe(JSON.stringify({ ok: true, entries: await createGitClient(repo).log({ maxCount: 20 }) }) + "\n");
  expect(io.stderr()).toBe("");
});

test("branches --json is the branches under ok", async () => {
  await inDir(repo, () => branchesCommand(["--json"]));
  expect(io.stdout()).toBe(JSON.stringify({ ok: true, branches: await createGitClient(repo).branches() }) + "\n");
  expect(io.stderr()).toBe("");
});

test("diff --json is the file diff under ok", async () => {
  await inDir(repo, () => diffCommand(["a.txt", "--json"]));
  expect(io.stdout()).toBe(JSON.stringify({ ok: true, diff: await createGitClient(repo).diffFile("a.txt", { staged: false }) }) + "\n");
  expect(io.stderr()).toBe("");
});

test("diff --json with no path is the usage envelope, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => diffCommand(["--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git diff <path> [--staged] [--json]"}\n');
  expect(io.stderr()).toBe("");
});

test("log --max with no value is a JSON error, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(repo, () => logCommand(["--max", "--json"])))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"--max requires a value"}\n');
});
