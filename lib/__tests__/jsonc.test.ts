import { describe, expect, test } from "bun:test";

import { jsoncSites, stripJsonc } from "../jsonc.ts";

describe("stripJsonc", () => {
  test("removes line + block comments and trailing commas", () => {
    const out = stripJsonc(`{
      // a comment
      "a": 1, /* inline */
      "b": 2,   // trailing comma below
    }`);
    expect(JSON.parse(out)).toEqual({ a: 1, b: 2 });
  });

  test("preserves // inside string values (origin URLs)", () => {
    const out = stripJsonc(`{
      "origin": "https://gitlab.com/acme/acme-dev.git", // the mirror origin
    }`);
    expect(JSON.parse(out)).toEqual({ origin: "https://gitlab.com/acme/acme-dev.git" });
  });

  test("a comma inside a string before a closer is not a trailing comma", () => {
    const out = stripJsonc(`{ "a": "x,{}" }`);
    expect(JSON.parse(out)).toEqual({ a: "x,{}" });
  });

  test("handles escaped quotes inside strings", () => {
    const out = stripJsonc(`{ "a": "say \\"hi\\" // not a comment", }`);
    expect(JSON.parse(out)).toEqual({ a: 'say "hi" // not a comment' });
  });

  test("trailing commas in arrays", () => {
    expect(JSON.parse(stripJsonc(`[1, 2, /* three */ ]`))).toEqual([1, 2]);
  });
});

describe("jsoncSites", () => {
  test("places every key and value by path, past comments and escapes", () => {
    const text = [
      '// header "quoted"',
      "{",
      '  "bindings": { /* c */ "a\\"b": { "rules": "x:y" } },',
      '  "list": [1, { "value": "" },],',
      "}",
    ].join("\n");
    const sites = jsoncSites(text);
    expect(sites.get(JSON.stringify(["bindings", 'a"b']))).toEqual({ key: { line: 3, col: 25 }, value: { line: 3, col: 33 } });
    expect(sites.get(JSON.stringify(["bindings", 'a"b', "rules"]))).toEqual({ key: { line: 3, col: 35 }, value: { line: 3, col: 44 } });
    expect(sites.get(JSON.stringify(["list", 0]))).toEqual({ key: null, value: { line: 4, col: 12 } });
    expect(sites.get(JSON.stringify(["list", 1, "value"]))).toEqual({ key: { line: 4, col: 17 }, value: { line: 4, col: 26 } });
  });

  test("stops quietly at text that is not JSONC", () => {
    expect(jsoncSites('{ "a": 1, oops }').get(JSON.stringify(["a"]))).toEqual({ key: { line: 1, col: 3 }, value: { line: 1, col: 8 } });
    expect(jsoncSites("[1, / ]").size).toBe(3);
    expect(jsoncSites('{ "a": "open').size).toBe(2);
  });
});
