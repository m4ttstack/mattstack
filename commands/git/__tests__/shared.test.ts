import { afterEach, beforeEach, expect, test } from "bun:test";
import * as out from "../../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../../lib/ui/__tests__/capture-out.ts";
import { asError, asRefusal, drawFailure, errText, failPlain, failUsage, failWith, NOT_ON_A_BRANCH, plural, readFlag, refuseWith, uncommittedChanges } from "../shared.ts";
import { exitCodeOf, trapExit } from "./helpers.ts";

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

test("failPlain under --json is the envelope on stdout, nothing on stderr, exit 1", async () => {
  expect(await exitCodeOf(async () => failPlain(true, "Could not read what has changed here", "fatal: not a git repository"))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"fatal: not a git repository"}\n');
  expect(io.stderr()).toBe("");
});

test("failPlain for a person is a plain title with git's own words under it, on stderr", async () => {
  expect(await exitCodeOf(async () => failPlain(false, "Could not read what has changed here", "fatal: not a git repository"))).toBe(1);
  expect(io.stderr()).toBe("Could not read what has changed here\n  fatal: not a git repository\n");
  expect(io.stdout()).toBe("");
});

test("git's own lines stay inside the block and lose their escapes", async () => {
  await exitCodeOf(async () => failPlain(false, "Could not push that tag", "fatal: bad \x1b[2Jref\nhint: try again"));
  expect(io.stderr()).toBe("Could not push that tag\n  fatal: bad ref\n  hint: try again\n");
});

test("failUsage keeps the usage string in the --json error, byte for byte", async () => {
  expect(await exitCodeOf(async () => failUsage(true, "Which file?", "usage: rt git diff <path> [--staged] [--json]"))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"usage: rt git diff <path> [--staged] [--json]"}\n');
  expect(io.stderr()).toBe("");
});

test("failUsage for a person asks for what is missing and names the command", async () => {
  await exitCodeOf(async () => failUsage(false, "Which file?", "usage: rt git diff <path> [--staged] [--json]", "Nothing has changed here, so there is no file to pick from."));
  expect(io.stderr()).toBe("Which file?\n  why: Nothing has changed here, so there is no file to pick from.\n  next: rt git diff <path> [--staged] [--json]\n");
});

test("failWith sends its own error string to --json and its own failure to a person", async () => {
  await exitCodeOf(async () => failWith(true, "Command failed: git fetch origin", { title: "Could not fetch from origin" }));
  expect(io.stdout()).toBe('{"ok":false,"error":"Command failed: git fetch origin"}\n');
  io.clear();
  await exitCodeOf(async () => failWith(false, "Command failed: git fetch origin", { title: "Could not fetch from origin" }));
  expect(io.stderr()).toBe("Could not fetch from origin\n");
  expect(io.stdout()).toBe("");
});

test("refuseWith keeps the --json error and shows a person a refused note, exit 1", async () => {
  const blocks = [out.line("refused", "The last commit is already pushed"), out.callout("why", "Undoing it here would leave this branch behind origin.")];
  expect(await exitCodeOf(async () => refuseWith(true, "refused: pushed", ...blocks))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"refused: pushed"}\n');
  expect(io.stderr()).toBe("");
  io.clear();
  expect(await exitCodeOf(async () => refuseWith(false, "refused: pushed", ...blocks))).toBe(1);
  expect(io.stderr()).toBe("[refused] The last commit is already pushed\n  why: Undoing it here would leave this branch behind origin.\n");
  expect(io.stdout()).toBe("");
});

test("readFlag returns the value, and a flag with nothing after it is a usage failure", async () => {
  const usage = "usage: rt git log [--max <n>] [--file <path>] [--json]";
  expect(readFlag(false, ["--max", "5"], "--max", usage)).toBe("5");
  expect(readFlag(false, [], "--max", usage)).toBeUndefined();
  expect(await exitCodeOf(async () => readFlag(true, ["--max", "--json"], "--max", usage))).toBe(1);
  expect(io.stdout()).toBe('{"ok":false,"error":"--max requires a value"}\n');
  io.clear();
  expect(await exitCodeOf(async () => readFlag(false, ["--max"], "--max", usage))).toBe(1);
  expect(io.stderr()).toBe("That option needs a value after it\n  next: rt git log [--max <n>] [--file <path>] [--json]\n");
});

test("drawFailure draws a refusal as a note and anything else as a failure", () => {
  drawFailure(NOT_ON_A_BRANCH);
  drawFailure(uncommittedChanges("A pull could overwrite them."), true);
  expect(io.stderr()).toBe(
    "You are not on a branch\n  why: This needs a branch, and HEAD is detached right now.\n" +
      "[refused] You have uncommitted changes\n  why: A pull could overwrite them.\n  next: Commit them, or set them aside with rt git stash push\n",
  );
  expect(io.stdout()).toBe("");
});

test("asError and asRefusal carry the title as the error string; only a refusal is marked", () => {
  expect(asError(NOT_ON_A_BRANCH)).toEqual({ error: "You are not on a branch", failure: NOT_ON_A_BRANCH });
  const dirty = uncommittedChanges("A pull could overwrite them.");
  expect(asRefusal(dirty)).toEqual({ error: "You have uncommitted changes", failure: dirty, refused: true });
});

test("plural and errText", () => {
  expect(plural(1, "file")).toBe("1 file");
  expect(plural(2, "file")).toBe("2 files");
  expect(plural(3, "branch", "branches")).toBe("3 branches");
  expect(errText(new Error("boom"))).toBe("boom");
  expect(errText("plain")).toBe("plain");
});
