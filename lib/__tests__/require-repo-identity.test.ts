import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { dispatch, type CommandNode } from "../command-tree.ts";
import { closeStateDb, setKvValue } from "../state/index.ts";
import * as out from "../ui/out.ts";
import { installFakePick } from "../ui/pick-fake.ts";
import { captureOut, type CapturedOut } from "../ui/__tests__/capture-out.ts";

const origHome = process.env.HOME;
const origCwd = process.cwd();
const origTTY = process.stdin.isTTY;
let batch: string | undefined;
let home: string;
let scratch: string;
let io: CapturedOut;
let exit: ReturnType<typeof spyOn>;
let fake: ReturnType<typeof installFakePick>;

beforeEach(() => {
  batch = process.env.RT_BATCH;
  delete process.env.RT_BATCH;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-require-home-")));
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "rt-require-repos-")));
  process.env.HOME = home;
  closeStateDb();
  for (const name of ["sample-app", "docs"]) {
    const dir = join(scratch, name);
    mkdirSync(dir);
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync("git -c user.email=t@example.com -c user.name=t commit --allow-empty -q -m init", { cwd: dir, stdio: "pipe" });
    setKvValue("repo-index", name, dir);
  }
  process.chdir(home);
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true, writable: true });
  fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
  io = captureOut();
  io.reset();
  out.__test__.setHuman(() => false);
  exit = spyOn(process, "exit").mockImplementation(((code: number) => { throw new Error(`exit ${code}`); }) as never);
});

afterEach(() => {
  exit.mockRestore();
  io.restore();
  fake.restore();
  if (batch === undefined) delete process.env.RT_BATCH;
  else process.env.RT_BATCH = batch;
  Object.defineProperty(process.stdin, "isTTY", { value: origTTY, configurable: true, writable: true });
  process.chdir(origCwd);
  process.env.HOME = origHome;
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const TREE: Record<string, CommandNode> = {
  listing: { description: "Lists, with its own --json", context: "repo", handler: async () => {}, args: [{ name: "JSON", flag: "--json", type: "boolean" }] },
  passing: { description: "Passes a command through", context: "repo", handler: async () => {}, args: [{ name: "Command", type: "text" }] },
};
const run = (...args: string[]) => dispatch(TREE, args, ["rt"], "");

test("outside a repo, a person at a terminal is asked which one", async () => {
  await expect(run("listing")).rejects.toThrow("exit 0");
  expect(fake.calls).toHaveLength(1);
});

test("outside a repo, a verb's own --json is told instead of asked", async () => {
  await expect(run("listing", "--json")).rejects.toThrow("exit 1");
  expect(fake.calls).toHaveLength(0);
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toContain("rt knows more than one repo and cannot ask which one you mean.");
});

test("outside a repo, a --json a verb only passes through still asks", async () => {
  await expect(run("passing", "npm", "ls", "--json")).rejects.toThrow("exit 0");
  expect(fake.calls).toHaveLength(1);
});

test("outside a repo, RT_BATCH is told instead of asked", async () => {
  process.env.RT_BATCH = "1";
  await expect(run("listing")).rejects.toThrow("exit 1");
  expect(fake.calls).toHaveLength(0);
});
