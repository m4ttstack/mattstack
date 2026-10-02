import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { getDef } from "../../../packages/rt-client/src/settings/registry-machinery.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import { __test__ as warnTest, setWarningLog } from "../warn.ts";
import { __test__, backgroundSetting } from "../background.ts";
import * as out from "../out.ts";
import { openStep } from "../spawn.ts";

const FAKE = resolve(import.meta.dir, "fake-rt-ui.ts");
const origHome = process.env.HOME;
let home: string;
let logged: string[];
let previousSink: ReturnType<typeof setSettingsNoticeSink>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rt-ui-bg-"));
  process.env.HOME = home;
  __test__.reset();
  warnTest.reset();
  logged = [];
  previousSink = setSettingsNoticeSink(() => {});
  setWarningLog((_module, message) => { logged.push(message); });
});

afterEach(() => {
  setSettingsNoticeSink(previousSink);
  process.env.HOME = origHome;
  __test__.reset();
  warnTest.reset();
  out.__test__.reset();
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(home, { recursive: true, force: true });
});

test("rt.ui.background is a user string key that defaults to auto", () => {
  const def = getDef("rt.ui.background");
  expect(def?.type).toBe("string");
  expect(def?.scopes).toEqual(["user"]);
  expect(getSetting("rt.ui.background").value).toBe("auto");
  expect(backgroundSetting()).toBe("auto");
});

test("the setting is read once per process", () => {
  setSetting("rt.ui.background", "dark", "user");
  expect(backgroundSetting()).toBe("dark");
  setSetting("rt.ui.background", "light", "user");
  expect(backgroundSetting()).toBe("dark");
  __test__.reset();
  expect(backgroundSetting()).toBe("light");
});

test("a word rt-ui does not know falls back to auto and is logged", () => {
  setSetting("rt.ui.background", "sepia", "user");
  expect(backgroundSetting()).toBe("auto");
  expect(logged.join("\n")).toContain("sepia");
});

test("a read that throws falls back to auto and is logged", () => {
  __test__.setRead(() => { throw new Error("store is malformed"); });
  expect(backgroundSetting()).toBe("auto");
  expect(logged.join("\n")).toContain("store is malformed");
});

test("rt-ui render gets the setting as RT_UI_BACKGROUND", () => {
  setSetting("rt.ui.background", "light", "user");
  const record = join(home, "render.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  out.__test__.setHuman(() => true);
  const realOut = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    out.print(out.line("done", "x"));
  } finally {
    process.stdout.write = realOut;
  }
  expect(JSON.parse(readFileSync(record, "utf8").split("\n")[0]!).bg).toBe("light");
});

test("rt-ui steps gets the setting as RT_UI_BACKGROUND", async () => {
  setSetting("rt.ui.background", "dark", "user");
  const record = join(home, "steps.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ envRecord: record });
  await openStep("x").done();
  expect(readFileSync(record, "utf8")).toContain(`{"bg":"dark"}`);
});
