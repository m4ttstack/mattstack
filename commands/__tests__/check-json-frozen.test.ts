/** The --json envelope of rt check is frozen byte for byte, with an empty stderr. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { CheckRun } from "../../lib/check/index.ts";
import { runCheck, type RunDeps } from "../../lib/check/run.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { checkCommand } from "../check.ts";

const ctx = { identity: { repoName: "widgets", identity: "unused", repoRoot: "/tree", dataDir: "/data", remoteUrl: "", baseUrl: "" } } as CommandContext;

type Configured = Extract<CheckRun["result"], { configured: true }>;
const green: Configured = {
  configured: true,
  verdict: "green",
  summary: { mode: "changed", selected: 95, passed: 95, failed: 0, durationMs: 41_200, failures: [] },
  sha: "abc123",
  base: "base456",
  dirty: false,
  command: "bun x",
  outputTail: "tail that must not leak",
  fromCache: false,
};

let io: CapturedOut;
beforeEach(() => {
  io = captureOut();
  out.__test__.setHuman(() => false);
  process.exitCode = 0;
});
afterEach(() => {
  io.restore();
  out.__test__.reset();
  process.exitCode = 0;
});

const run = (r: CheckRun) => checkCommand(["--json"], ctx, { run: async () => r, hostname: () => "hilbert" });

test("green prints the frozen envelope", async () => {
  await run({
    result: green,
    status: { posted: true, context: "rt/local-check", state: "success", description: "changed: 95 tests in 41s on hilbert" },
  });
  expect(io.stdout()).toBe(
    '{"configured":true,"verdict":"green","sha":"abc123","base":"base456","dirty":false,"fromCache":false,"summary":{"mode":"changed","selected":95,"passed":95,"failed":0,"durationMs":41200,"failures":[]},"status":{"posted":true,"context":"rt/local-check","state":"success","description":"changed: 95 tests in 41s on hilbert"}}\n',
  );
  expect(io.stderr()).toBe("");
  expect(process.exitCode).toBe(0);
});

test("a red envelope carries the failing test names in its summary", async () => {
  const summary = { mode: "changed", selected: 95, passed: 94, failed: 1, durationMs: 41_200, failures: ["lib/a.test.ts"], failedTests: ["cart > rounds up"] };
  await run({ result: { ...green, verdict: "red", summary }, status: null });
  expect(JSON.parse(io.stdout()).summary).toEqual(summary);
  expect(io.stderr()).toBe("");
});

test("a token in a test name never reaches the envelope", async () => {
  const token = "ghp_notarealtokennotarealtoken";
  const stdout = JSON.stringify({ mode: "changed", selected: 2, passed: 1, failed: 1, durationMs: 10, failures: ["lib/a.test.ts"], failedTests: [`logs in with ${token}`] });
  const deps: RunDeps = {
    git: async (args) => ({ code: 0, stdout: args[0] === "status" ? "" : "abc123\n", stderr: "" }),
    exec: async () => ({ stdout: `${stdout}\n`, stderr: "", exitCode: 1 }),
    setting: () => ({ command: "bun x" }),
    now: () => 0,
  };
  await checkCommand(["--json"], ctx, {
    run: async (tree, opts) => ({ result: await runCheck(tree, opts, deps), status: null }),
    hostname: () => "hilbert",
  });
  expect(io.stdout()).not.toContain(token);
  expect(JSON.parse(io.stdout()).summary.failedTests).toEqual(["logs in with [redacted]"]);
});

test("unconfigured prints configured false", async () => {
  await run({ result: { configured: false }, status: null });
  expect(io.stdout()).toBe('{"configured":false}\n');
  expect(io.stderr()).toBe("");
});

test("an error adds its reason, prints the JSON on stdout and exits non-zero", async () => {
  await run({ result: { ...green, verdict: "error", reason: "timed out after 600s" }, status: null });
  const body = JSON.parse(io.stdout());
  expect(body).toMatchObject({ verdict: "error", status: null, reason: "timed out after 600s" });
  expect(io.stderr()).toBe("");
  expect(process.exitCode).toBe(1);
});
