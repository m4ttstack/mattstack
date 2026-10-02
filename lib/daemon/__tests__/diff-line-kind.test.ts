import { describe, expect, test } from "bun:test";
import { checkAnchor, classifyNewLine } from "../diff-line-kind.ts";

const TWO_HUNKS = [
  "@@ -1,4 +1,4 @@",
  " a",
  "-b",
  "+B",
  " c",
  " d",
  "@@ -20,3 +20,4 @@",
  " t",
  "+u",
  " v",
  " w",
].join("\n");

describe("classifyNewLine", () => {
  test("an added line is added", () => {
    expect(classifyNewLine(TWO_HUNKS, 2)).toEqual({ kind: "added" });
    expect(classifyNewLine(TWO_HUNKS, 21)).toEqual({ kind: "added" });
  });

  test("a context line after a removal reports its old line", () => {
    expect(classifyNewLine(TWO_HUNKS, 3)).toEqual({ kind: "context", oldLine: 3 });
    expect(classifyNewLine(TWO_HUNKS, 1)).toEqual({ kind: "context", oldLine: 1 });
  });

  test("old and new counters drift across an earlier hunk", () => {
    const diff = ["@@ -1,2 +1,4 @@", " a", "+x", "+y", " b", "@@ -10,2 +12,2 @@", " p", " q"].join("\n");
    expect(classifyNewLine(diff, 12)).toEqual({ kind: "context", oldLine: 10 });
    expect(classifyNewLine(diff, 13)).toEqual({ kind: "context", oldLine: 11 });
    expect(classifyNewLine(diff, 4)).toEqual({ kind: "context", oldLine: 2 });
  });

  test("a line between two hunks is outside, with the nearest diff lines", () => {
    const res = classifyNewLine(TWO_HUNKS, 10);
    expect(res.kind).toBe("outside");
    if (res.kind === "outside") expect(res.nearest).toEqual([4, 3, 2]);
  });

  test("a line past the end is outside", () => {
    const res = classifyNewLine(TWO_HUNKS, 99);
    expect(res.kind).toBe("outside");
    if (res.kind === "outside") expect(res.nearest).toEqual([23, 22, 21]);
  });

  test("a new file is all added lines", () => {
    const diff = ["@@ -0,0 +1,3 @@", "+one", "+two", "+three"].join("\n");
    expect(classifyNewLine(diff, 3)).toEqual({ kind: "added" });
    expect(classifyNewLine(diff, 4)).toEqual({ kind: "outside", nearest: [3, 2, 1] });
  });

  test("the no-newline marker consumes no line numbers", () => {
    const diff = ["@@ -1,2 +1,2 @@", " a", "-b", "\\ No newline at end of file", "+c", "\\ No newline at end of file"].join("\n");
    expect(classifyNewLine(diff, 2)).toEqual({ kind: "added" });
    expect(classifyNewLine(diff, 1)).toEqual({ kind: "context", oldLine: 1 });
  });

  test("an empty diff has nothing near", () => {
    expect(classifyNewLine("", 5)).toEqual({ kind: "outside", nearest: [] });
  });
});

describe("checkAnchor", () => {
  const page = (over: object = {}, truncated = false) =>
    ({ diffs: [{ newPath: "src/a.ts", oldPath: "src/old-a.ts", diff: TWO_HUNKS, ...over }], truncated });

  test("a context line is anchorable with its old line and old path", () => {
    expect(checkAnchor(page(), "src/a.ts", 3)).toEqual({ kind: "anchorable", oldPath: "src/old-a.ts", oldLine: 3 });
  });

  test("an added line is anchorable on its new line alone", () => {
    expect(checkAnchor(page(), "src/a.ts", 2)).toEqual({ kind: "anchorable", oldPath: "src/old-a.ts" });
  });

  test("a line the diff does not show is outside", () => {
    expect(checkAnchor(page(), "src/a.ts", 10).kind).toBe("outside");
  });

  test("a file missing from a whole page has no diff", () => {
    expect(checkAnchor(page(), "src/b.ts", 1)).toEqual({ kind: "no-file" });
  });

  test("a file missing from a full page, or one GitLab did not render, cannot be checked", () => {
    expect(checkAnchor(page({}, true), "src/b.ts", 1)).toEqual({ kind: "anchorable" });
    expect(checkAnchor(page({ collapsed: true }), "src/a.ts", 10)).toEqual({ kind: "anchorable", oldPath: "src/old-a.ts" });
    expect(checkAnchor(page({ diff: "" }), "src/a.ts", 10)).toEqual({ kind: "anchorable", oldPath: "src/old-a.ts" });
  });
});
