import { expect, test } from "bun:test";
import { collectSources, macosOnlyTests } from "../ci/test-scope.ts";

const { tests, sources } = collectSources();
const list = macosOnlyTests();

test("every entry on the macOS-only list is a unit test that exists, so the list cannot go stale", () => {
  expect(list.length).toBeGreaterThan(0);
  expect(list.filter((f) => !tests.includes(f))).toEqual([]);
});

test("a test gated off other hosts is on the list: ubuntu would pass it without running it", () => {
  const gated = tests.filter((f) => /process\.platform !== "darwin"/.test(sources.get(f) ?? ""));
  expect(gated.length).toBeGreaterThan(0);
  expect(gated.filter((f) => !list.includes(f))).toEqual([]);
});
