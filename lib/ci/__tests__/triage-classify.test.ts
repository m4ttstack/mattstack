import { describe, expect, test } from "bun:test";
import { classifyTrace, isNoisy, stripAnsi } from "../triage-classify.ts";
import { compilePatterns, type CompiledPatterns } from "../triage-config.ts";

const cfg = {
  realPatterns: [],
  infraPatterns: [],
  noisyJobs: [],
  baseDepth: 3,
  baseRef: null,
  skipBase: false,
};
const compiled = compilePatterns(cfg, []);
if ("error" in compiled) throw new Error(compiled.error);
const patterns: CompiledPatterns = compiled;

describe("classifyTrace", () => {
  test("a nonzero failed count is REAL", () => {
    expect(classifyTrace("Tests: 1 failed, 3 passed", patterns).verdict).toBe("REAL");
  });

  test("a zero failed count with passes alone is UNCLEAR", () => {
    expect(classifyTrace("Tests: 0 failed, 3 passed", patterns).verdict).toBe("UNCLEAR");
  });

  test("0 Failed is UNCLEAR, case-insensitively", () => {
    expect(classifyTrace("0 Failed", patterns).verdict).toBe("UNCLEAR");
  });

  test("a nonzero failure count beats a zero error count on the same line", () => {
    expect(classifyTrace("Tests: 1 failed, 0 errors", patterns).verdict).toBe("REAL");
    expect(classifyTrace("Tests: 0 failed, 0 errors, 3 passed", patterns).verdict).toBe("UNCLEAR");
  });

  test("the filter keeps a bare count line, which then needs a pattern to hit", () => {
    expect(classifyTrace("1 failed, 0 errors", patterns).verdict).toBe("UNCLEAR");
    const custom = compilePatterns({ ...cfg, realPatterns: ["^\\d+ failed"] }, []);
    if ("error" in custom) throw new Error(custom.error);
    expect(classifyTrace("1 failed, 0 errors", custom).verdict).toBe("REAL");
    expect(classifyTrace("0 failed, 3 passed", custom).verdict).toBe("UNCLEAR");
  });

  test("a count like 10 failed is nonzero; 100 is not read as zero", () => {
    expect(classifyTrace("Tests: 10 failed, 3 passed", patterns).verdict).toBe("REAL");
    expect(classifyTrace("Tests: 100 failed, 0 errors", patterns).verdict).toBe("REAL");
  });

  test("a pass line without a failure count is dropped before matching", () => {
    expect(classifyTrace("FAIL check passed", patterns).verdict).toBe("UNCLEAR");
  });

  test("REAL wins over INFRA and both hit lists fill", () => {
    const r = classifyTrace("npm ERR ECONNRESET\nsrc/a.ts error TS1234: bad\n", patterns);
    expect(r.verdict).toBe("REAL");
    expect(r.realHits).toEqual(["src/a.ts error TS1234: bad"]);
    expect(r.infraHits).toEqual(["npm ERR ECONNRESET"]);
  });

  test("INFRA alone gives INFRA", () => {
    const r = classifyTrace("No space left on device", patterns);
    expect(r.verdict).toBe("INFRA");
    expect(r.realHits).toEqual([]);
  });

  test("ANSI codes are stripped before matching and from hits", () => {
    const r = classifyTrace("\x1b[31mFAIL \x1b[0m src/a.test.ts", patterns);
    expect(r.verdict).toBe("REAL");
    expect(r.realHits).toEqual(["FAIL  src/a.test.ts"]);
    expect(r.realHits.join("")).not.toContain("\x1b");
  });

  test("REAL hits cap at five and INFRA hits at three", () => {
    const real = Array.from({ length: 7 }, (_, i) => `FAIL case ${i}`).join("\n");
    const infra = Array.from({ length: 5 }, () => "ETIMEDOUT").join("\n");
    const r = classifyTrace(`${real}\n${infra}`, patterns);
    expect(r.realHits).toHaveLength(5);
    expect(r.infraHits).toHaveLength(3);
  });

  test("matching is case-sensitive", () => {
    expect(classifyTrace("econnreset", patterns).verdict).toBe("UNCLEAR");
  });

  test("an empty trace is UNCLEAR", () => {
    expect(classifyTrace("", patterns).verdict).toBe("UNCLEAR");
  });
});

describe("stripAnsi", () => {
  test("removes SGR sequences only", () => {
    expect(stripAnsi("\x1b[1;31mred\x1b[0m")).toBe("red");
    expect(stripAnsi("\x1b[2Kkeep")).toBe("\x1b[2Kkeep");
  });
});

describe("isNoisy", () => {
  test("substring match only when allow_failure", () => {
    expect(isNoisy("semgrep-sast", true, ["semgrep-sast"])).toBe(true);
    expect(isNoisy("semgrep-sast", false, ["semgrep-sast"])).toBe(false);
    expect(isNoisy("test+coverage", true, ["test+cov"])).toBe(true);
  });

  test("no entries means not noisy; an empty entry never matches", () => {
    expect(isNoisy("anything", true, [])).toBe(false);
    expect(isNoisy("anything", true, [""])).toBe(false);
  });
});
