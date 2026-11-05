import { describe, expect, test } from "bun:test";
import type { DepsLockTool } from "../../lib/bundle-layout.ts";
import { rowsFor, toTsvRow } from "../lib/deps-lock.ts";

function tool(overrides: Partial<DepsLockTool> = {}): DepsLockTool {
  return {
    name: "fzf",
    version: "1.0.0",
    license: "MIT",
    url: "https://example.com/x",
    sha256: "a".repeat(64),
    archive: "raw",
    extract: "",
    bundlePath: "Contents/Helpers/fzf",
    exec: ["Contents/Helpers/fzf"],
    exposeByDefault: false,
    entitlements: "none",
    status: "bundled",
    kind: "helper",
    ...overrides,
  };
}

describe("deps-lock.ts TSV emitter", () => {
  test("emits 12 tab-separated fields in the documented order", () => {
    expect(toTsvRow(tool()).split("\t")).toHaveLength(12);
  });
  test("emits fields in the documented column order", () => {
    const t = tool({
      name: "toolname",
      version: "9.9.9",
      url: "https://example.com/toolname",
      sha256: "b".repeat(64),
      archive: "tar.gz",
      extract: "toolname",
      bundlePath: "Contents/Helpers/toolname",
      entitlements: "jit",
      status: "bundled",
      kind: "helper",
      exposeByDefault: true,
    });
    expect(toTsvRow(t).split("\t")).toEqual([
      "toolname",
      "9.9.9",
      "https://example.com/toolname",
      "b".repeat(64),
      "tar.gz",
      "toolname",
      "Contents/Helpers/toolname",
      "jit",
      "bundled",
      "helper",
      "true",
      "",
    ]);
  });
  test("throws rather than emit a field containing a tab", () => {
    expect(() => toTsvRow(tool({ version: "1.0\t0" }))).toThrow(/tab or newline/);
  });
  test("throws rather than emit a field containing a newline", () => {
    expect(() => toTsvRow(tool({ url: "https://example.com/x\ny" }))).toThrow(/tab or newline/);
  });
  test("throws rather than emit a field containing a carriage return", () => {
    expect(() => toTsvRow(tool({ extract: "a\rb" }))).toThrow(/tab or newline/);
  });
  test("a served app row still emits 12 fields and serve never reaches the TSV", () => {
    const cols = toTsvRow(tool({
      name: "board", bundlePath: "Contents/Helpers/board", exec: ["Contents/Helpers/board"],
      serve: { port: 11006, args: ["serve"] },
    })).split("\t");
    expect(cols).toHaveLength(12);
    expect(cols).not.toContain("11006");
  });
  test("a tree row's 12th field is its source, url and sha256 emit empty", () => {
    const { url: _u, sha256: _s, ...rest } = tool({ name: "board", source: "tree" });
    const cols = toTsvRow(rest as DepsLockTool).split("\t");
    expect(cols).toHaveLength(12);
    expect(cols[2]).toBe("");
    expect(cols[3]).toBe("");
    expect(cols[11]).toBe("tree");
  });
  test("a fetched row's 12th field is empty", () => {
    expect(toTsvRow(tool()).split("\t")[11]).toBe("");
  });
});

describe("deps-lock.ts rowsFor", () => {
  const pin = { url: "https://example.com/x-amd64", sha256: "b".repeat(64), extract: "x-amd64/x" };
  test("arm64 rows keep their own url, sha256 and extract", () => {
    const [row] = rowsFor([tool({ x86_64: pin })], "arm64");
    expect(row!.url).toBe("https://example.com/x");
  });
  test("x86_64 rows take the pin's url, sha256 and extract", () => {
    const [row] = rowsFor([tool({ x86_64: pin })], "x86_64");
    expect([row!.url, row!.sha256, row!.extract]).toEqual([pin.url, pin.sha256, pin.extract]);
  });
  test("x86_64 passes through rows that are the same on both chips or built per chip", () => {
    const rows = rowsFor([
      tool({ name: "npmtool", archive: "npm", extract: "package" }),
      tool({ name: "zstd", archive: "make-src", extract: "zstd-1" }),
      tool({ name: "gotool", archive: "go-src", extract: "gotool-1" }),
      tool({ name: "sparkle", kind: "buildtool", bundlePath: "tools/sparkle", exec: ["tools/sparkle/bin/x"] }),
      tool({ name: "board", url: undefined, sha256: undefined, source: "tree" }),
      tool({ name: "later", status: "pending", url: "", sha256: "" }),
    ], "x86_64");
    expect(rows.map((r) => r.name)).toEqual(["npmtool", "zstd", "gotool", "sparkle", "board", "later"]);
    expect(rows.map((r) => r.url)).toEqual(["https://example.com/x", "https://example.com/x", "https://example.com/x", "https://example.com/x", undefined, ""]);
  });
  test("x86_64 refuses a bundled prebuilt helper with no pin", () => {
    expect(() => rowsFor([tool({ name: "jq" })], "x86_64")).toThrow(/jq has no x86_64 pin/);
  });
});
