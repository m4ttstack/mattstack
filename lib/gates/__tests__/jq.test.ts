import { describe, expect, test } from "bun:test";
import {
  JqError,
  asciiLower,
  asciiUpper,
  cpLength,
  cpSlice,
  hasNonSpace,
  isSpace,
  jqCompare,
  jqGet,
  jqHas,
  ok,
  tojson,
  utf8Bytes,
} from "../jq.ts";

describe("jq semantics", () => {
  test("tojson escapes DEL and leaves U+2028 raw", () => {
    expect(tojson("a\x7fb c")).toBe('"a\\u007fb c"');
    expect(tojson("a\u2028b")).toBe('"a\u2028b"');
    expect(tojson({ a: [1, "x\x7f"] })).toBe('{"a":[1,"x\\u007f"]}');
  });

  test("utf8 bytes and codepoint indexing", () => {
    expect(utf8Bytes("é…𝄞")).toBe(9);
    expect(cpLength("a𝄞b")).toBe(3);
    expect(cpSlice("a𝄞b", 1, 2)).toBe("𝄞");
    expect(cpSlice("a𝄞b", 1)).toBe("𝄞b");
  });

  test("whitespace is Oniguruma \\s", () => {
    expect(hasNonSpace(" \u0085")).toBe(false);
    expect(hasNonSpace("\ufeff")).toBe(true);
    expect(hasNonSpace("\u200b")).toBe(true);
    expect(hasNonSpace("\u001c")).toBe(true);
    expect(hasNonSpace("\t\n\u000b\f\r \u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000")).toBe(false);
    expect(isSpace("x")).toBe(false);
  });

  test("ascii case maps ASCII letters only", () => {
    expect(asciiUpper("ß-é-x")).toBe("ß-é-X");
    expect(asciiLower("ÀB-c")).toBe("Àb-c");
  });

  test("jqCompare orders by type, then value", () => {
    const ordered = [null, false, true, 1, "a", [], {}];
    const shuffled = [{}, "a", true, [], 1, null, false];
    expect([...shuffled].sort(jqCompare)).toEqual(ordered);
    expect(jqCompare("\uffff", "𝄞")).toBeLessThan(0);
    expect(jqCompare([1, 2], [1, 3])).toBeLessThan(0);
    expect(jqCompare({ b: 1 }, { a: 1 })).toBeGreaterThan(0);
    expect(jqCompare({ a: 1 }, { a: 2 })).toBeLessThan(0);
    expect(jqCompare({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(0);
  });

  test("jqHas and jqGet throw where jq errors", () => {
    expect(() => jqHas("x", "k")).toThrow(JqError);
    expect(jqHas(null, "k")).toBe(false);
    expect(() => jqHas([], "k")).toThrow(JqError);
    expect(jqHas({ k: null }, "k")).toBe(true);
    expect(jqGet(null, "k")).toBeNull();
    expect(jqGet({}, "k")).toBeNull();
    expect(() => jqGet([], "k")).toThrow(JqError);
    expect(() => jqGet(1, "k")).toThrow(JqError);
  });

  test("ok is false on throw, else jq truthiness", () => {
    expect(ok(() => jqGet("s", "k"))).toBe(false);
    expect(ok(() => null)).toBe(false);
    expect(ok(() => false)).toBe(false);
    expect(ok(() => 0)).toBe(true);
    expect(ok(() => "")).toBe(true);
  });
});
