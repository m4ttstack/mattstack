import { beforeAll, expect, test } from "bun:test";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const ALREADY_SET = "process.exitCode was already";
let out = "";
let outBoth = "";
let outLast = "";
let lastExit = 0;

beforeAll(() => {
  const run = Bun.spawnSync(
    [process.execPath, "test", "./lib/__tests__/fixtures/exitcode-guard-first-file.ts"],
    { cwd: REPO_ROOT, env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  out = run.stdout.toString() + run.stderr.toString();

  const runBoth = Bun.spawnSync(
    [process.execPath, "test", "./lib/__tests__/fixtures/exitcode-guard-both-broken-file.ts"],
    { cwd: REPO_ROOT, env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  outBoth = runBoth.stdout.toString() + runBoth.stderr.toString();

  const runLast = Bun.spawnSync(
    [process.execPath, "test", "./lib/__tests__/fixtures/exitcode-guard-last-afterall-file.ts"],
    { cwd: REPO_ROOT, env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  outLast = runLast.stdout.toString() + runLast.stderr.toString();
  lastExit = runLast.exitCode ?? 0;
});

test("an afterAll that leaves process.exitCode set after the last test fails the run with a message, not a bare exit 1", () => {
  expect(lastExit).not.toBe(0);
  expect(outLast).toContain("process.exitCode was left at 2 when the run ended");
  expect(outLast).toMatch(/\b1 fail\b/);
});

test("the preload guard fails the test that leaves process.exitCode set, not the next one", () => {
  expect(out).toContain("After this test: process.exitCode was left at 1");
  expect(out).toContain("(fail) leaves exitCode set");
  expect(out).not.toContain("(fail) runs next");
});

test("an exitCode leaked from an afterAll fails the next test once and is repaired before it runs", () => {
  expect(out).toContain(`${ALREADY_SET} 2 when this test started`);
  expect(out).toContain("(fail) starts after the afterAll");
  expect(out).not.toContain("(fail) starts after the repair");
});

test("a test that breaks both HOME and exitCode is the one guard failure names, not the next test", () => {
  expect(outBoth).toContain('After this test: HOME is "undefined"');
  expect(outBoth).toContain("After this test: process.exitCode was left at 1");
  expect(outBoth).toContain("(fail) breaks both HOME and exitCode");
  expect(outBoth).not.toContain("(fail) runs after breaking both");
});
