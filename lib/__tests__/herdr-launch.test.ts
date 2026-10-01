/**
 * launchFallback (lib/herdr-launch.ts): the real text, not a mock of it.
 * Every launchQueue and launchPreset test elsewhere mocks this function
 * away, so nothing else pins what it writes.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { launchFallback, type LaunchItem } from "../herdr-launch.ts";
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  io = captureOut();
  ui.__test__.reset();
  ui.__test__.setHuman(() => false);
});
afterEach(() => io.restore());

test("names the caller's reason, then one heading per item, all on stderr", () => {
  const items: LaunchItem[] = [
    { label: "web → dev", command: "true", cwd: process.cwd() },
    { label: "api → start", command: "true", cwd: process.cwd() },
  ];
  launchFallback(items, "tmux is not on PATH");

  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("[warning] Running these one at a time  tmux is not on PATH\nweb → dev\napi → start\n");
});

test("names a non-zero exit against the item's own label", () => {
  const items: LaunchItem[] = [{ label: "web → dev", command: "exit 7", cwd: process.cwd() }];
  launchFallback(items, "not running in an interactive terminal");

  expect(io.errLines().at(-1)).toBe("[failed] web → dev stopped with an error  exit 7");
});

test("stays on stderr when the verb's stdout is a payload", () => {
  ui.payloadOnStdout();
  launchFallback([{ label: "web → dev", command: "true", cwd: process.cwd() }], "tmux is not on PATH");
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toContain("Running these one at a time");
});
