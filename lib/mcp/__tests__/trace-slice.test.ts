import { describe, expect, test } from "bun:test";
import { sliceTrace, TRACE_MAX_BYTES } from "../trace-slice.ts";

const log = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

describe("sliceTrace", () => {
  test("tail keeps the last lines", () => {
    expect(sliceTrace(log, { kind: "tail", lines: 2 })).toEqual({ trace: "line 9\nline 10", truncated: true, totalLines: 10 });
  });
  test("head keeps the first lines", () => {
    expect(sliceTrace(log, { kind: "head", lines: 2 })).toEqual({ trace: "line 1\nline 2", truncated: true, totalLines: 10 });
  });
  test("range is 1-based and inclusive of fromLine", () => {
    expect(sliceTrace(log, { kind: "range", from: 4, count: 2 })).toEqual({ trace: "line 4\nline 5", truncated: true, totalLines: 10 });
  });
  test("a range past the end is empty, with the real line count and no error", () => {
    expect(sliceTrace(log, { kind: "range", from: 50, count: 5 })).toEqual({ trace: "", truncated: true, totalLines: 10 });
  });
  test("grep numbers each line and separates groups", () => {
    const r = sliceTrace("a\nERROR one\nb\nc\nd\nerror two\n", { kind: "grep", pattern: "error", context: 1 });
    expect(r.trace).toBe("1: a\n2: ERROR one\n3: b\n--\n5: d\n6: error two");
    expect(r.totalLines).toBe(6);
  });
  test("grep with no match is empty and not an error", () => {
    expect(sliceTrace(log, { kind: "grep", pattern: "nope", context: 2 })).toEqual({ trace: "", truncated: true, totalLines: 10 });
  });
  test("grep treats the pattern as plain text", () => {
    expect(sliceTrace("a.b\naxb\n", { kind: "grep", pattern: "a.b", context: 0 }).trace).toBe("1: a.b");
  });
  test("strips ANSI escapes before counting", () => {
    expect(sliceTrace("\x1b[31mred\x1b[0m\n", { kind: "head", lines: 5 })).toEqual({ trace: "red", truncated: false, totalLines: 1 });
  });
  test("a head over the byte cap is cut from the end, a tail from the start", () => {
    const big = `${"x".repeat(TRACE_MAX_BYTES)}\nEND\n`;
    expect(sliceTrace(big, { kind: "head", lines: 5 }).trace.startsWith("xxx")).toBe(true);
    expect(sliceTrace(big, { kind: "head", lines: 5 }).trace.length).toBe(TRACE_MAX_BYTES);
    expect(sliceTrace(big, { kind: "tail", lines: 5 }).trace.endsWith("END")).toBe(true);
  });
});
