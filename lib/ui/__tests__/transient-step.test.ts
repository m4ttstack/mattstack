import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { __test__ as gate } from "../gate.ts";
import { withTransientStep } from "../transient-step.ts";
import { withInlineSpinner } from "../../tui/inline-spinner.ts";

const FAKE = resolve(import.meta.dir, "fake-rt-ui.ts");
let dir: string;
let record: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-transient-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  // bun test's stdin is not a TTY; the gate is opened here and closed only
  // in the test that is about it.
  gate.setInteractive(() => true);
});
afterEach(() => {
  gate.setInteractive(undefined);
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("runs the task under a step and ends it with clear", async () => {
  expect(await withTransientStep("scanning ports…", async () => 42)).toBe(42);
  expect(sent()).toEqual([{ t: "hello", protocol: 1 }, { t: "start", title: "scanning ports…" }, { t: "done", title: "scanning ports…", clear: true }]);
});

test("a task that throws still clears, and the error reaches the caller", async () => {
  await expect(
    withTransientStep("scanning ports…", async () => {
      throw new Error("lsof died");
    }),
  ).rejects.toThrow("lsof died");
  expect(sent().at(-1)).toEqual({ t: "done", title: "scanning ports…", clear: true });
});

test("off a terminal nothing is spawned and the task still runs", async () => {
  gate.setInteractive(() => false);
  expect(await withTransientStep("scanning ports…", async () => "ran")).toBe("ran");
  expect(existsSync(record)).toBe(false);
});

test("a missing helper costs the spinner, never the task", async () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  expect(await withTransientStep("scanning ports…", async () => "ran")).toBe("ran");
});

test("a helper that dies mid-step does not fail the task", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
  const result = await withTransientStep("scanning ports…", async () => {
    await Bun.sleep(150);
    return "ran";
  });
  expect(result).toBe("ran");
});

test("withInlineSpinner is the transient step under its old name", () => {
  expect(withInlineSpinner).toBe(withTransientStep);
});
