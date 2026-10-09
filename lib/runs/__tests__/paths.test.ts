import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { root } from "./fixtures.ts";
import { runDirExists } from "../paths.ts";

afterEach(() => { delete process.env.RT_RUNS_ROOT; });

test("runDirExists finds a run under any repo and rejects unsafe ids", () => {
  const dir = root();
  mkdirSync(join(dir, "remote:alpha", "20261008-1"), { recursive: true });
  expect(runDirExists("20261008-1")).toBe(true);
  expect(runDirExists("20261008-2")).toBe(false);
  expect(runDirExists("../x")).toBe(false);
});

test("runDirExists is false when the runs root is missing", () => {
  process.env.RT_RUNS_ROOT = join(mkdtempSync(join(tmpdir(), "rt-runs-")), "absent");
  expect(runDirExists("20261008-1")).toBe(false);
});

test("runDirExists keeps (true) when the runs root cannot be read for another reason", () => {
  const file = join(mkdtempSync(join(tmpdir(), "rt-runs-")), "not-a-dir");
  writeFileSync(file, "");
  process.env.RT_RUNS_ROOT = file;
  expect(runDirExists("20261008-1")).toBe(true);
});
