import { describe, expect, test } from "bun:test";
import { diffStoreKeys } from "../store-diff.ts";

const FILE = "mattstack/org/settings.org.jsonc";

describe("diffStoreKeys", () => {
  test("reports an added, a changed and a removed global key", () => {
    const before = `{ "b": 1, "c": true }`;
    const after = `{ "a": "x", "b": 2 }`;
    expect(diffStoreKeys(FILE, before, after)).toEqual([
      { key: "a", change: "added" },
      { key: "b", change: "changed" },
      { key: "c", change: "removed" },
    ]);
  });

  test("ignores a reformatted or recommented file", () => {
    const before = `{"a": [1, 2], "b": {"x": 1, "y": 2}}`;
    const after = `// org settings\n{\n  "b": { "y": 2, "x": 1 }, // reordered\n  "a": [\n    1,\n    2,\n  ],\n}\n`;
    expect(diffStoreKeys(FILE, before, after)).toEqual([]);
  });

  test("reports a key inside repos.<identity>", () => {
    const before = `{"repos":{"gh/acme/web":{"x":1}}}`;
    const after = `{"repos":{"gh/acme/web":{"x":2}}}`;
    expect(diffStoreKeys(FILE, before, after)).toEqual([{ key: "x", repo: "gh/acme/web", change: "changed" }]);
  });

  test("a file new at origin reads every key as added", () => {
    const after = `{"b": 1, "a": 2, "repos": {"gh/acme/web": {"x": 1}}}`;
    expect(diffStoreKeys(FILE, null, after)).toEqual([
      { key: "a", change: "added" },
      { key: "b", change: "added" },
      { key: "x", repo: "gh/acme/web", change: "added" },
    ]);
  });

  test("a deleted file reads every key as removed", () => {
    const before = `{"a": 1, "repos": {"gh/acme/web": {"x": 1}}}`;
    expect(diffStoreKeys(FILE, before, null)).toEqual([
      { key: "a", change: "removed" },
      { key: "x", repo: "gh/acme/web", change: "removed" },
    ]);
  });

  test("a nested object change reports its top-level key once", () => {
    const before = `{"board.slack": {"emoji": {"looking": "eyes", "done": "check"}}}`;
    const after = `{"board.slack": {"emoji": {"looking": "mag", "done": "check"}}}`;
    expect(diffStoreKeys(FILE, before, after)).toEqual([{ key: "board.slack", change: "changed" }]);
  });

  test("an unchanged file reports nothing", () => {
    const text = `{"a": 1, "repos": {"gh/acme/web": {"x": 1}}}`;
    expect(diffStoreKeys(FILE, text, text)).toEqual([]);
  });
});
