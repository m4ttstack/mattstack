import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { macosOnlyTests, ROOT, unitDirs } from "../ci/test-scope.ts";

const SELF = "scripts/__tests__/no-macos-list-drift.test.ts";

// A test turned off everywhere but a Mac. A ternary picking a value still runs
// and asserts on ubuntu, so it does not count.
const OFF_OTHER_HOSTS = /process\.platform\s*!==?\s*["']darwin["']|process\.platform\s*===?\s*["']linux["']|\bif\s*\(\s*process\.platform\s*===?\s*["']darwin["']/;

const tests = unitDirs().flatMap((dir) => {
  const root = dir.replace(/^\.\//, "");
  return [...new Bun.Glob("**/*.test.{ts,tsx}").scanSync({ cwd: join(ROOT, root) })]
    .filter((f) => !f.includes("node_modules/"))
    .map((f) => join(root, f));
});
const list = macosOnlyTests();

test("every entry on the macOS-only list is a unit test that exists, so the list cannot go stale", () => {
  expect(list.length).toBeGreaterThan(0);
  expect(list.filter((f) => !tests.includes(f))).toEqual([]);
});

test("a test gated off other hosts is on the list: ubuntu would pass it without running it", () => {
  const gated = tests.filter((f) => f !== SELF && OFF_OTHER_HOSTS.test(readFileSync(join(ROOT, f), "utf8")));
  expect(gated.length).toBeGreaterThan(0);
  expect(gated.filter((f) => !list.includes(f))).toEqual([]);
});

test.each([
  ['if (process.platform !== "darwin") return;', true],
  ['describe.skipIf(process.platform !== "darwin")("x", () => {});', true],
  ['describe.skipIf(process.platform === "linux")("x", () => {});', true],
  ['test.if(process.platform === "darwin")("x", () => {});', true],
  ['if (process.platform === "darwin") expect(a).toBe(b);', true],
  ['const cwd = process.platform === "darwin" ? "/private/tmp" : "/tmp";', false],
])("%s reads as gated: %p", (source, gated) => {
  expect(OFF_OTHER_HOSTS.test(source)).toBe(gated);
});
