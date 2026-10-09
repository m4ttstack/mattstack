import { afterEach, expect, test } from "bun:test";
import { mkdirSync } from "fs";
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
