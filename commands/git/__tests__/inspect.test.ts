import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BranchInfo, FileDiff, LogEntry, RepoSnapshot } from "../../../packages/git-core/src/index.ts";
import * as out from "../../../lib/ui/out.ts";
import { renderPlain } from "../../../lib/ui/out-plain.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { branchesBlocks, diffBlocks, diffCommand, logBlocks, logCommand, statusBlocks, statusCommand } from "../inspect.ts";
import { exitCodeOf, inDir, makeRepo, trapExit } from "./helpers.ts";

const snap = (over: Partial<RepoSnapshot>): RepoSnapshot => ({ branch: "main", detached: false, upstream: null, ahead: null, behind: null, files: [], clean: true, ...over });
const branch = (over: Partial<BranchInfo>): BranchInfo => ({ name: "main", current: false, sha: "0123456789abcdef", upstream: null, upstreamGone: false, ahead: null, behind: null, committedAt: "2026-09-30T10:00:00Z", ...over });
const entry = (sha: string, authorDate: string, subject: string): LogEntry => ({ sha, parents: [], authorName: "Sam Sample", authorEmail: "sam@example.test", authorDate, subject, body: "" });

test("status names the branch, where it stands, and each changed file", () => {
  const blocks = statusBlocks(
    snap({
      branch: "feature/login",
      upstream: "origin/feature/login",
      ahead: 1,
      behind: 2,
      clean: false,
      files: [
        { path: "a.txt", kind: "modified", staged: false, unstaged: true },
        { path: "new.txt", kind: "untracked", staged: false, unstaged: true },
        { path: "b.txt", kind: "renamed", staged: true, unstaged: true, originalPath: "old.txt" },
      ],
    }),
  );
  expect(renderPlain(blocks)).toBe(
    "feature/login  tracking origin/feature/login, 1 ahead, 2 behind\n" +
      "FILE                 CHANGE     STAGED\n" +
      "a.txt                modified   no\n" +
      "new.txt              untracked  no\n" +
      "b.txt (was old.txt)  renamed    partly\n",
  );
});

test("a clean tree and a detached HEAD each say so", () => {
  expect(renderPlain(statusBlocks(snap({})))).toBe("main\n[ok] Nothing to commit\n");
  expect(renderPlain(statusBlocks(snap({ branch: null, detached: true })))).toBe("detached HEAD\n[ok] Nothing to commit\n");
});

test("log lists short sha, day and subject, and says when there is nothing", () => {
  expect(renderPlain(logBlocks([entry("0123456789abcdef", "2026-09-30T10:00:00Z", "add the login form"), entry("fedcba9876543210", "2026-09-29T09:00:00Z", "first commit")]))).toBe(
    "01234567  2026-09-30  add the login form\nfedcba98  2026-09-29  first commit\n",
  );
  expect(renderPlain(logBlocks([]))).toBe("[skipped] No commits to show\n");
});

test("branches says which is current and how each stands against its upstream", () => {
  const blocks = branchesBlocks([
    branch({ name: "main", current: true, upstream: "origin/main", ahead: 0, behind: 0 }),
    branch({ name: "feature/login", upstream: "origin/feature/login", ahead: 2, behind: 1 }),
    branch({ name: "old-idea", upstream: "origin/old-idea", upstreamGone: true }),
    branch({ name: "scratch" }),
  ]);
  expect(renderPlain(blocks)).toBe(
    "main           current, tracking origin/main\n" +
      "feature/login  tracking origin/feature/login, 2 ahead, 1 behind\n" +
      "old-idea       tracking origin/old-idea, its upstream is gone\n" +
      "scratch\n",
  );
  expect(renderPlain(branchesBlocks([]))).toBe("[skipped] No branches yet\n");
});

test("a branch name with a right-to-left override prints without it", () => {
  const hostile = "main" + String.fromCodePoint(0x202e) + "txt";
  expect(renderPlain(branchesBlocks([branch({ name: hostile, current: true })]))).toBe("maintxt  current\n");
  expect(renderPlain(statusBlocks(snap({ branch: hostile })))).toBe("maintxt\n[ok] Nothing to commit\n");
});

test("diff is one diff block; a binary file, a submodule and an unchanged file each say so", () => {
  const text: FileDiff = {
    path: "a.txt",
    kind: "text",
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        header: "@@ -1,2 +1,2 @@",
        lines: [
          { type: "context", content: "keep", oldLineNo: 1, newLineNo: 1 },
          { type: "del", content: "one", oldLineNo: 2, newLineNo: null },
          { type: "add", content: "two", oldLineNo: null, newLineNo: 2 },
        ],
      },
    ],
  };
  expect(diffBlocks(text).map((b) => b.t)).toEqual(["diff"]);
  expect(renderPlain(diffBlocks(text))).toBe("@@ -1,2 +1,2 @@\n  keep\n- one\n+ two\n");
  expect(renderPlain(diffBlocks({ path: "logo.png", kind: "binary", hunks: [] }))).toBe("[skipped] logo.png is a binary file  no line diff to show\n");
  expect(renderPlain(diffBlocks({ path: "vendor/kit", kind: "submodule", hunks: [] }))).toBe("[skipped] vendor/kit is a submodule  no line diff to show\n");
  expect(renderPlain(diffBlocks({ path: "a.txt", kind: "text", hunks: [] }))).toBe("[skipped] No changes in a.txt\n");
});

let root: string;
let io: CapturedOut;
let exit: { restore(): void };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "rt-inspect-")));
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

test("status prints on stdout and leaves stderr empty", async () => {
  const repo = makeRepo(root);
  writeFileSync(join(repo, "a.txt"), "two\n");
  await inDir(repo, () => statusCommand([]));
  expect(io.stdout()).toBe("main\nFILE   CHANGE    STAGED\na.txt  modified  no\n");
  expect(io.stderr()).toBe("");
});

test("status in a repo with no commits names its unborn branch", async () => {
  const empty = join(root, "empty");
  execFileSync("git", ["init", "-q", "-b", "main", empty], { stdio: "pipe" });
  await inDir(empty, () => statusCommand([]));
  expect(io.stdout()).toBe("main\n[ok] Nothing to commit\n");
});

test("diff with no path off a terminal asks which file, on stderr, exit 1", async () => {
  const repo = makeRepo(root);
  expect(await exitCodeOf(() => inDir(repo, () => diffCommand([])))).toBe(1);
  expect(io.stderr()).toBe("Which file?\n  next: rt git diff <path> [--staged] [--json]\n");
  expect(io.stdout()).toBe("");
});

test("log with a value flag and nothing after it asks for the value, not git", async () => {
  const repo = makeRepo(root);
  expect(await exitCodeOf(() => inDir(repo, () => logCommand(["--max"])))).toBe(1);
  expect(io.stderr()).toBe("--max needs a value after it\n  next: rt git log [--max <n>] [--file <path>] [--json]\n");
  expect(io.stdout()).toBe("");
});

test("outside a repo the failure opens with a plain title, exit 1", async () => {
  expect(await exitCodeOf(() => inDir(root, () => statusCommand([])))).toBe(1);
  expect(io.errLines()[0]).toBe("Could not read what has changed here");
  expect(io.errLines().length).toBeGreaterThan(1);
  expect(io.stdout()).toBe("");
});
