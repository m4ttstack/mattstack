import { describe as group, expect, test } from "bun:test";
import { describe, parseSummary } from "../summary.ts";

group("parseSummary", () => {
  test("reads the last stdout line as the summary", () => {
    const s = parseSummary('noise\n{"mode":"changed","selected":95,"passed":95,"failed":0,"durationMs":41200,"failures":[]}\n', 0, 50_000);
    expect(s).toEqual({ mode: "changed", selected: 95, passed: 95, failed: 0, durationMs: 41200, failures: [] });
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
  test("an exit-only green names the exit and the time", () => {
    expect(describe("green", { mode: "exit", selected: null, passed: null, failed: null, durationMs: 12_000, failures: [] }, "hilbert")).toBe("exit 0 in 12s on hilbert");
  });
  test("an exit-only red never prints null", () => {
    expect(describe("red", { mode: "exit", selected: null, passed: null, failed: null, durationMs: 12_000, failures: [] }, "hilbert")).toBe("red: command failed in 12s on hilbert");
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
