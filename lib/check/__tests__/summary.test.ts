import { describe as group, expect, test } from "bun:test";
import { describe, MAX_FAILED_TESTS, MAX_TEST_NAME_LENGTH, parseSummary } from "../summary.ts";

group("parseSummary", () => {
  test("reads the last stdout line as the summary", () => {
    const s = parseSummary('noise\n{"mode":"changed","selected":95,"passed":95,"failed":0,"durationMs":41200,"failures":[]}\n', 0, 50_000);
    expect(s).toEqual({ mode: "changed", selected: 95, passed: 95, failed: 0, durationMs: 41200, failures: [] });
  });
  test("a red run keeps its failing test names", () => {
    const s = parseSummary('{"mode":"changed","selected":3,"passed":2,"failed":1,"durationMs":10,"failures":["lib/a.test.ts"],"failedTests":["cart > rounds up",7]}', 1, 50);
    expect(s.failedTests).toEqual(["cart > rounds up"]);
    expect(s.failures).toEqual(["lib/a.test.ts"]);
  });
  test("an exit 0 never carries failing test names", () => {
    const s = parseSummary('{"mode":"changed","selected":3,"passed":3,"failed":0,"durationMs":10,"failures":[],"failedTests":["cart > rounds up"]}', 0, 50);
    expect(s).toEqual({ mode: "changed", selected: 3, passed: 3, failed: 0, durationMs: 10, failures: [] });
  });
  test("a summary with no names has no failedTests key", () => {
    expect(parseSummary('{"mode":"full","failed":2,"failedTests":[]}', 1, 50)).not.toHaveProperty("failedTests");
    expect(parseSummary('{"mode":"full","failed":2}', 1, 50)).not.toHaveProperty("failedTests");
  });
  test("another repo's command cannot put an unbounded list in the summary", () => {
    const names = Array.from({ length: MAX_FAILED_TESTS + 5 }, (_, i) => `name ${i} ${"x".repeat(MAX_TEST_NAME_LENGTH * 2)}`);
    const files = Array.from({ length: MAX_FAILED_TESTS + 5 }, (_, i) => `lib/${i}.test.ts`);
    const s = parseSummary(JSON.stringify({ mode: "full", failed: 25, failures: files, failedTests: names }), 1, 50);
    expect(s.failedTests).toHaveLength(MAX_FAILED_TESTS);
    expect(s.failedTests![0]).toHaveLength(MAX_TEST_NAME_LENGTH);
    expect(s.failedTests![0]).toEndWith("...");
    expect(s.failures).toEqual(files.slice(0, MAX_FAILED_TESTS));
  });
  test("a list inside the cap keeps every name as it came", () => {
    const files = Array.from({ length: MAX_FAILED_TESTS }, (_, i) => `lib/${i}.test.ts`);
    const name = "x".repeat(MAX_TEST_NAME_LENGTH);
    const s = parseSummary(JSON.stringify({ mode: "full", failed: 20, failures: files, failedTests: [name] }), 1, 50);
    expect(s.failures).toEqual(files);
    expect(s.failedTests).toEqual([name]);
  });
  test("redaction runs before the clip, so a long name cannot cut a token out of its shape", () => {
    const token = "ghp_notarealtokennotarealtoken";
    const name = `${"x".repeat(MAX_TEST_NAME_LENGTH - 10)} ${token}`;
    const s = parseSummary(JSON.stringify({ mode: "full", failed: 1, failedTests: [name] }), 1, 50);
    expect(s.failedTests![0]).not.toContain("ghp_");
  });
  test("no summary line is a green exit", () => {
    expect(parseSummary("ran fine\n", 0, 12_000)).toEqual({ mode: "exit", selected: null, passed: null, failed: null, durationMs: 12_000, failures: [] });
  });
  test("a non-object last line is no summary", () => {
    expect(parseSummary("[1,2]\n", 0, 100).mode).toBe("exit");
    expect(parseSummary("42", 1, 100).mode).toBe("exit");
  });
  test("a partial object keeps what it has and fills the rest", () => {
    expect(parseSummary('{"mode":"full","failed":2}', 1, 9_000)).toEqual({ mode: "full", selected: null, passed: null, failed: 2, durationMs: 9_000, failures: [] });
  });
});

group("describe", () => {
  const green = { mode: "changed", selected: 95, passed: 95, failed: 0, durationMs: 41_200, failures: [] };
  test("green names mode, count, time and machine", () => {
    expect(describe("green", green, "hilbert")).toBe("changed: 95 tests in 41s on hilbert");
  });
  test("full and long runs read in minutes and seconds", () => {
    expect(describe("green", { ...green, mode: "full", selected: 22236, durationMs: 372_000 }, "hilbert")).toBe("full: 22236 tests in 6m12s on hilbert");
  });
  test("one test reads singular", () => {
    expect(describe("green", { ...green, selected: 1, passed: 1 }, "hilbert")).toBe("changed: 1 test in 41s on hilbert");
  });
  test("skip says nothing ran", () => {
    expect(describe("green", { ...green, mode: "skip", selected: 0 }, "hilbert")).toBe("skip: nothing to run for this diff");
  });
  test("red counts failures and names the first file with a +n tail", () => {
    const red = { ...green, failed: 2, failures: ["lib/__tests__/x.test.ts", "lib/__tests__/y.test.ts"] };
    expect(describe("red", red, "hilbert")).toBe("red: 2 of 95 failed, lib/__tests__/x.test.ts +1");
  });
  test("failing test names stay out of the description, which a forge shows", () => {
    const red = { ...green, failed: 1, failures: ["lib/__tests__/x.test.ts"], failedTests: ["cart > rounds up"] };
    expect(describe("red", red, "hilbert")).toBe("red: 1 of 95 failed, lib/__tests__/x.test.ts");
  });
  test("an exit-only green names the exit and the time", () => {
    expect(describe("green", { mode: "exit", selected: null, passed: null, failed: null, durationMs: 12_000, failures: [] }, "hilbert")).toBe("exit 0 in 12s on hilbert");
  });
  test("an exit-only red never prints null", () => {
    expect(describe("red", { mode: "exit", selected: null, passed: null, failed: null, durationMs: 12_000, failures: [] }, "hilbert")).toBe("red: command failed in 12s on hilbert");
  });
  test("a red with no failures counted reads as a failed command", () => {
    expect(describe("red", { ...green, passed: 0, selected: 0, failed: 0 }, "hilbert")).toBe("red: command failed in 41s on hilbert");
  });
  test("a timeout names its limit", () => {
    expect(describe("error", green, "hilbert", 600)).toBe("error: timed out after 600s");
  });
  test("any other error is rt's own sentence", () => {
    expect(describe("error", green, "hilbert")).toBe("error: the check could not run");
  });
  test("credentials in a summary the command printed never reach the description", () => {
    const secret = "ghp_" + "a".repeat(32);
    expect(describe("red", { ...green, failed: 1, failures: [`https://x:${secret}@github.com/a.test.ts`] }, "hilbert")).not.toContain(secret);
    expect(describe("green", { ...green, mode: `token ${secret}` }, "hilbert")).not.toContain(secret);
  });
  test("redaction runs before the clip, so a cut token still goes", () => {
    const secret = "ghp_" + "a".repeat(200);
    const text = describe("red", { ...green, failed: 1, failures: [`${"x".repeat(110)} ${secret}`] }, "hilbert");
    expect(text).not.toContain("ghp_");
  });
  test("never exceeds 140 characters", () => {
    const long = { ...green, failed: 1, failures: ["a/".repeat(90) + "z.test.ts"] };
    expect(describe("red", long, "hilbert").length).toBeLessThanOrEqual(140);
  });
});
