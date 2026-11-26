import { test, expect, beforeEach, afterEach } from "bun:test";
import { __test__, suppressDaemonDownWarning } from "../daemon-client.ts";
import * as out from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  io = captureOut();
  out.__test__.setHuman(() => false);
  __test__.resetDownWarning();
});
afterEach(() => {
  __test__.resetDownWarning();
  io.restore();
});

test("the daemon-down note is one warn line and the command to run, on stderr, once", () => {
  __test__.warnDaemonDown();
  __test__.warnDaemonDown();
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("[warning] The rt daemon is not running\n  next: rt daemon start\n");
});

test("a caller that owns the screen can silence it", () => {
  suppressDaemonDownWarning();
  __test__.warnDaemonDown();
  expect(io.stderr()).toBe("");
});
