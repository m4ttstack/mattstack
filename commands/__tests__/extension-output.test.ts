import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { __test__ } from "../extension.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { __test__ as gate } from "../../lib/ui/gate.ts";

const FAKE_UI = resolve(import.meta.dir, "..", "..", "lib", "ui", "__tests__", "fake-rt-ui.ts");
const EDITORS = [
  { name: "Sample Code", cliPath: "/apps/sample-code" },
  { name: "Sample Editor", cliPath: "/apps/sample-editor" },
];
const install = async (cliPath: string) =>
  cliPath === "/apps/sample-code" ? { ok: true as const } : { ok: false as const, output: "Installing extensions...\nExtension is not compatible with this build\n" };

let io: ReturnType<typeof captureOut>;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-extension-output-"));
  io = captureOut();
  ui.__test__.reset();
  ui.__test__.setHuman(() => false);
});
afterEach(() => {
  io.restore();
  gate.setInteractive(undefined);
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

test("off a terminal: one line per editor as it lands, then a count and what to do next", async () => {
  gate.setInteractive(() => false);
  expect(await __test__.installInto(EDITORS, "/x/rt-context.vsix", install)).toBe(1);
  expect(io.lines()).toEqual([
    "[ok] Installed in Sample Code",
    "[failed] Sample Editor did not take the extension  Extension is not compatible with this build",
    "[ok] RT Context is installed  1 of 2 editors",
    "  next: Restart your editor to turn it on",
  ]);
});

test("at a terminal: one step per editor, ended done or failed by the helper", async () => {
  const record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE_UI;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  gate.setInteractive(() => true);

  await __test__.installInto(EDITORS, "/x/rt-context.vsix", install);

  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.t !== "hello");
  expect(sent).toEqual([
    { t: "start", title: "Installing in Sample Code" },
    { t: "done", title: "Installed in Sample Code" },
    { t: "start", title: "Installing in Sample Editor" },
    { t: "fail", title: "Sample Editor did not take the extension", hint: "Extension is not compatible with this build" },
  ]);
  expect(io.lines()).toEqual(["[ok] RT Context is installed  1 of 2 editors", "  next: Restart your editor to turn it on"]);
});

test("when no editor took it there is no installed summary", async () => {
  gate.setInteractive(() => false);
  expect(await __test__.installInto([EDITORS[1]!], "/x/rt-context.vsix", install)).toBe(0);
  expect(io.lines()).toEqual(["[failed] Sample Editor did not take the extension  Extension is not compatible with this build"]);
});

test("an editor that failed without a word says it gave no reason", async () => {
  gate.setInteractive(() => false);
  await __test__.installInto([EDITORS[1]!], "/x/rt-context.vsix", async () => ({ ok: false, output: "" }));
  expect(io.lines()).toEqual(["[failed] Sample Editor did not take the extension  it gave no reason"]);
});

test("an install that was stopped at 30 seconds says it timed out", async () => {
  gate.setInteractive(() => false);
  await __test__.installInto([EDITORS[1]!], "/x/rt-context.vsix", async () => ({ ok: false, timedOut: true, output: "Installing extensions..." }));
  expect(io.lines()).toEqual(["[failed] Sample Editor did not take the extension  it did not finish within 30 seconds"]);
});
