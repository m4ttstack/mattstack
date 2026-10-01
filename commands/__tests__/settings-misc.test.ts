import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sendTestPushNotification } from "../settings.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

const origHome = process.env.HOME;
let home: string;
let cap: ReturnType<typeof captureOut>;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-misc-")));
  process.env.HOME = home;
  cap = captureOut();
  out.__test__.setHuman(() => false);
});

afterEach(() => {
  cap.restore();
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

test("test-push with no app running is an off line, not a failure", async () => {
  await sendTestPushNotification();
  expect(cap.stdout()).toBe("[off] The mattstack app is not running  open it, then try again\n");
  expect(cap.stderr()).toBe("");
  expect(process.exitCode ?? 0).toBe(0);
});
