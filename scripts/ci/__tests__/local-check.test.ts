import { describe, expect, test } from "bun:test";
import { availableParallelism } from "os";
import { judgeRun, parseTestOutput, planLocalCheck, processCount, stopGroups, summarise } from "../local-check.ts";
import { unitDirs } from "../test-scope.ts";

const BASE = "abc123";
const HEAD = "def456";

const sources = new Map<string, string>([
  ["lib/__tests__/dev-mode.test.ts", `readFileSync(join(ROOT, "rt-tray", "build.sh"), "utf8");`],
  ["lib/__tests__/cart.test.ts", `import { total } from "../cart.ts";`],
  ["lib/cart.ts", ""],
]);
const scope = {
  sources,
  preloadImports: new Set<string>(),
  tests: ["lib/__tests__/dev-mode.test.ts", "lib/__tests__/cart.test.ts"],
  graph: new Map<string, string[]>([
    ["lib/__tests__/cart.test.ts", ["lib/cart.ts"]],
    ["lib/__tests__/dev-mode.test.ts", []],
    ["lib/cart.ts", []],
  ]),
  tracked: new Set<string>(),
};

  // Captured from `bun test` run with stderr and stdout split: a file with a bad
  // import beside a green one. The file header and the summary are on stderr.
  const loadFailure = `
lib/__tests__/bad-import.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './missing.ts' from '/repo/lib/__tests__/bad-import.test.ts'
-------------------------------


 1 pass
 1 fail
 1 error
 1 expect() calls
Ran 2 tests across 2 files. [5.00ms]
`;


describe("planLocalCheck", () => {
  test("a docs-only diff plans skip and nothing runs", () => {
    const plan = planLocalCheck(BASE, HEAD, false, scope, ["docs/architecture.md"]);
    expect(plan).toEqual({ mode: "skip", dirs: [], changedArg: null, extra: [], processes: 0 });
  });

  test("a typescript diff plans --changed=<base> plus the read-by-path extras", () => {
    const plan = planLocalCheck(BASE, HEAD, false, scope, ["lib/cart.ts", "rt-tray/build.sh"]);
    expect(plan.mode).toBe("changed");
    expect(plan.dirs).toEqual(unitDirs());
    expect(plan.changedArg).toBe(`--changed=${BASE}`);
    expect(plan.extra).toEqual(["./lib/__tests__/dev-mode.test.ts"]);
    expect(plan.processes).toBe(1);
  });

  test("a typescript change no test reaches, with no extras, plans skip", () => {
    const plan = planLocalCheck(BASE, HEAD, false, scope, ["lib/orphan.ts"]);
    expect(plan).toEqual({ mode: "skip", dirs: [], changedArg: null, extra: [], processes: 0 });
  });

  test("a change reached only by path plans the extras with one process", () => {
    const plan = planLocalCheck(BASE, HEAD, false, scope, ["rt-tray/build.sh"]);
    expect(plan.mode).toBe("changed");
    expect(plan.extra).toEqual(["./lib/__tests__/dev-mode.test.ts"]);
    expect(plan.processes).toBe(1);
  });

  test("RT_CHECK_FULL plans the full suite with no --changed", () => {
    const plan = planLocalCheck(BASE, HEAD, true, scope, ["docs/architecture.md"]);
    expect(plan.mode).toBe("full");
    expect(plan.dirs).toEqual(unitDirs());
    expect(plan.changedArg).toBeNull();
    expect(plan.extra).toEqual([]);
    expect(plan.processes).toBe(processCount(availableParallelism()));
  });

  test("a full-mode decision (the shard workflow) plans full", () => {
    const plan = planLocalCheck(BASE, HEAD, false, scope, [".github/workflows/checks.yml"]);
    expect(plan.mode).toBe("full");
    expect(plan.changedArg).toBeNull();
  });
});

describe("processCount", () => {
  test.each([
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [10, 5],
    [12, 6],
    [64, 6],
  ])("%i cores runs %i processes", (cores, expected) => {
    expect(processCount(cores)).toBe(expected);
  });
});

describe("parseTestOutput", () => {
  // Captured from `bun test` writing to a pipe: two failing files.
  const fixture = `bun test v1.4.3 (c6da4a4d3)

lib/__tests__/cart.test.ts:
error: expect(received).toBe(expected)

Expected: 2
Received: 1

(fail) cart totals > rounds up [0.09ms]

lib/daemon/__tests__/gate-push.test.ts:
error: expect(received).toBe(expected)

Expected: 3
Received: 1

(fail) gate push > refuses a moved head [0.01ms]
error: expect(received).toBe(expected)

Expected: 4
Received: 1

(fail) gate push > names the override [0.01ms]

 41 pass
 3 fail
 52 expect() calls
Ran 44 tests across 9 files. [3.00ms]
`;

  test("counts pass and fail from bun's summary lines", () => {
    expect(parseTestOutput(fixture)).toMatchObject({ passed: 41, failed: 3, summarised: true });
  });

  test("names each failing file once, in order", () => {
    expect(parseTestOutput(fixture).failures).toEqual(["lib/__tests__/cart.test.ts", "lib/daemon/__tests__/gate-push.test.ts"]);
  });

  test("reads the file header behind a GitHub Actions group prefix", () => {
    const grouped = fixture.replaceAll("\nlib/", "\n::group::lib/");
    expect(parseTestOutput(grouped).failures).toEqual(["lib/__tests__/cart.test.ts", "lib/daemon/__tests__/gate-push.test.ts"]);
  });

  test("ignores colour codes", () => {
    const coloured = fixture.replace(" 41 pass", " \x1b[32m41 pass\x1b[0m").replace("(fail) cart", "\x1b[31m(fail)\x1b[0m cart");
    expect(parseTestOutput(coloured)).toMatchObject({ passed: 41, failed: 3 });
  });

  test("output with no summary line is not summarised", () => {
    expect(parseTestOutput("bun test v1.4.3\nKilled\n")).toEqual({ passed: 0, failed: 0, failures: [], summarised: false });
  });

  test("a green run has no failures", () => {
    expect(parseTestOutput("bun test v1.4.3\n\n 5 pass\n 0 fail\nRan 5 tests across 1 files. [3.00ms]\n")).toEqual({
      passed: 5,
      failed: 0,
      failures: [],
      summarised: true,
    });
  });

  test("a file that fails to load is named, though it has no (fail) line", () => {
    expect(parseTestOutput(loadFailure)).toEqual({ passed: 1, failed: 1, failures: ["lib/__tests__/bad-import.test.ts"], summarised: true });
  });
});

describe("judgeRun", () => {
  test("a green exit with a summary is not red", () => {
    expect(judgeRun(0, "\n 5 pass\n 0 fail\nRan 5 tests across 1 files. [3.00ms]\n")).toEqual({ red: false, passed: 5, failed: 0, failures: [] });
  });

  test("a process that dies with no summary counts one failure", () => {
    expect(judgeRun(137, "bun test v1.4.3\n")).toEqual({ red: true, passed: 0, failed: 1, failures: [] });
  });

  test("a non-zero exit beside a clean summary still counts one failure", () => {
    expect(judgeRun(1, " 5 pass\n 0 fail\n")).toMatchObject({ red: true, failed: 1 });
  });

  test("a red summary keeps bun's own count", () => {
    expect(judgeRun(1, loadFailure)).toMatchObject({ red: true, passed: 1, failed: 1, failures: ["lib/__tests__/bad-import.test.ts"] });
  });
});

describe("summarise", () => {
  // Bun's stderr tail from a green shard: `56` files ran 2047 tests, so the two counts differ.
  const greenShard = " 2047 pass\n 0 fail\n 5120 expect() calls\nRan 2047 tests across 56 files. [87.00s]\n";
  const redShard = "lib/__tests__/cart.test.ts:\n(fail) cart totals > rounds up [0.09ms]\n\n 41 pass\n 3 fail\nRan 44 tests across 9 files. [3.00ms]\n";

  test("selected counts the tests that ran, not the files picked", () => {
    expect(summarise("changed", [judgeRun(0, greenShard)], 87_000)).toEqual({ mode: "changed", selected: 2047, passed: 2047, failed: 0, durationMs: 87_000, failures: [] });
  });

  test("a red run never fails more tests than it selected", () => {
    const s = summarise("changed", [judgeRun(1, redShard), judgeRun(0, greenShard)], 90_000);
    expect(s).toMatchObject({ selected: 2091, passed: 2088, failed: 3, failures: ["lib/__tests__/cart.test.ts"] });
  });

  test("a run that ran nothing reports skip", () => {
    expect(summarise("changed", [judgeRun(0, " 0 pass\n 0 fail\nRan 0 tests across 0 files. [1.00ms]\n")], 10)).toMatchObject({ mode: "skip", selected: 0 });
    expect(summarise("full", [], 10)).toMatchObject({ mode: "skip", selected: 0 });
  });

  test("a process that died with no summary is not a skip", () => {
    expect(summarise("changed", [judgeRun(137, "bun test v1.4.3\n")], 10)).toMatchObject({ mode: "changed", selected: 1, failed: 1 });
  });
});

describe("stopGroups", () => {
  test("signals every group, negating the pid", () => {
    const sent: number[] = [];
    stopGroups([1, 2], (pid) => void sent.push(pid));
    expect(sent).toEqual([-1, -2]);
  });

  test("a group that is already gone does not stop the rest", () => {
    const sent: number[] = [];
    stopGroups([1, 2], (pid) => {
      sent.push(pid);
      if (pid === -1) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    });
    expect(sent).toEqual([-1, -2]);
  });
});
