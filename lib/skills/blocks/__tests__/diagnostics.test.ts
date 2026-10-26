import { expect, test } from "bun:test";
import { BlockError, formatDiagnostic } from "../diagnostics.ts";

test("formatDiagnostic prints file:line:col: message", () => {
  expect(formatDiagnostic({ file: "a/b.block.md", line: 3, col: 7, message: "x", code: "unknown-prop" })).toBe("a/b.block.md:3:7: x");
});
test("BlockError's message joins its diagnostics one per line", () => {
  const err = new BlockError([{ file: "a.block.md", line: 1, col: 1, message: "m1", code: "unknown-prop" }, { file: "b.block.md", line: 2, col: 3, message: "m2", code: "required-prop" }]);
  expect(err.message).toBe("a.block.md:1:1: m1\nb.block.md:2:3: m2");
});
