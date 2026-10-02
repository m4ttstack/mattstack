import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { getDef } from "../../../packages/rt-client/src/settings/registry-machinery.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import { __test__ as warnTest, setWarningLog } from "../warn.ts";
import { __test__, backgroundSetting, rtUiEnv } from "../background.ts";
import * as out from "../out.ts";
import { openStep } from "../spawn.ts";

const FAKE = resolve(import.meta.dir, "fake-rt-ui.ts");
const origHome = process.env.HOME;
const preloadBlock = process.env.RT_UI_NO_TERMINAL_QUERY;
let home: string;
let logged: string[];
let previousSink: ReturnType<typeof setSettingsNoticeSink>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rt-ui-bg-"));
  delete process.env.RT_UI_NO_TERMINAL_QUERY;
  process.env.HOME = home;
  __test__.reset();
  __test__.setTTY(() => true);
  warnTest.reset();
  logged = [];
  previousSink = setSettingsNoticeSink(() => {});
  setWarningLog((_module, message) => { logged.push(message); });
});

afterEach(() => {
  process.env.RT_UI_NO_TERMINAL_QUERY = preloadBlock;
  setSettingsNoticeSink(previousSink);
  process.env.HOME = origHome;
  __test__.reset();
  warnTest.reset();
  out.__test__.reset();
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  delete process.env.RT_UI_BACKGROUND;
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

function renders(fake: Record<string, unknown>, times: number): { argv: string[]; bg?: string }[] {
  const record = join(home, "renders.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record, ...fake });
  out.__test__.setHuman(() => true);
  const realOut = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    for (let i = 0; i < times; i++) out.print(out.line("done", `x${i}`));
  } finally {
    process.stdout.write = realOut;
  }
  return readFileSync(record, "utf8").split("\n").filter((l) => l.startsWith(`{"argv"`)).map((l) => JSON.parse(l));
}

test("auto asks the first render to report, then passes its answer on", async () => {
  const sent = renders({ renderErr: "background=dark\n" }, 3);
  expect(sent[0]).toEqual({ argv: expect.arrayContaining(["--report-background"]), bg: "auto" });
  for (const later of sent.slice(1)) {
    expect(later.bg).toBe("dark");
    expect(later.argv).not.toContain("--report-background");
  }
  const record = join(home, "steps-after.ndjson");
  process.env.RT_UI_FAKE = JSON.stringify({ envRecord: record });
  await openStep("x").done();
  expect(readFileSync(record, "utf8")).toContain(`{"bg":"dark"}`);
});

test("an unknown answer is passed on as unknown, so the helper does not ask again", () => {
  const sent = renders({ renderErr: "background=unknown\n" }, 2);
  expect(sent[1]!.bg).toBe("unknown");
});

test("a helper that reports nothing keeps getting auto", () => {
  const sent = renders({}, 2);
  expect(sent.map((s) => s.bg)).toEqual(["auto", "auto"]);
});

test("auto is not passed unless stdin, stdout and stderr are all terminals", () => {
  process.env.RT_UI_BACKGROUND = "auto";
  for (const which of ["stdin", "stdout", "stderr"]) {
    __test__.reset();
    __test__.setTTY((stream) => stream !== which);
    const env = rtUiEnv();
    expect(env.RT_UI_BACKGROUND, which).toBeUndefined();
    expect("RT_UI_BACKGROUND" in env, which).toBe(false);
  }
  const sent = renders({ renderErr: "background=dark\n" }, 1);
  expect(sent[0]!.bg).toBeUndefined();
  expect(sent[0]!.argv).not.toContain("--report-background");
});

test("dark and light are passed whatever the streams are", () => {
  setSetting("rt.ui.background", "light", "user");
  __test__.setTTY(() => false);
  expect(rtUiEnv().RT_UI_BACKGROUND).toBe("light");
});

test("the test preload keeps auto from ever reaching rt-ui", () => {
  expect(preloadBlock).toBe("1");
  process.env.RT_UI_NO_TERMINAL_QUERY = preloadBlock;
  __test__.reset();
  __test__.setTTY(() => true);
  const env = rtUiEnv();
  expect(env.RT_UI_BACKGROUND).toBeUndefined();
  expect(env.RT_UI_NO_TERMINAL_QUERY).toBe("1");
});

test("every auto helper of one rt process shares one run id", () => {
  const first = rtUiEnv();
  const second = rtUiEnv();
  expect(first.RT_UI_BACKGROUND).toBe("auto");
  expect(first.RT_UI_BACKGROUND_RUN).toMatch(/\S{8,}/);
  expect(second.RT_UI_BACKGROUND_RUN).toBe(first.RT_UI_BACKGROUND_RUN);
  setSetting("rt.ui.background", "dark", "user");
  __test__.reset();
  expect("RT_UI_BACKGROUND_RUN" in rtUiEnv()).toBe(false);
});

function stepUnderFake(fake: Record<string, unknown>): { renderRecord: string; stepsRecord: string } {
  const renderRecord = join(home, "settle.ndjson");
  const stepsRecord = join(home, "settle-steps.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record: renderRecord, envRecord: stepsRecord, ...fake });
  return { renderRecord, stepsRecord };
}

test("a step under auto settles the background before its helper starts", async () => {
  const { renderRecord, stepsRecord } = stepUnderFake({ renderErr: "background=light\n" });
  await openStep("x").done();
  const hello = `{"t":"hello","protocol":1}`;
  expect(readFileSync(renderRecord, "utf8")).toStartWith(`{"argv":["--report-background"],"bg":"auto"}\n${hello}\n${hello}\n{"t":"start"`);
  expect(readFileSync(stepsRecord, "utf8")).toContain(`{"bg":"light"}`);
  await openStep("y").done();
  expect(readFileSync(renderRecord, "utf8").split("\n").filter((l) => l.startsWith(`{"argv"`))).toHaveLength(1);
});

test("a step whose settling run fails still starts under auto", async () => {
  const { renderRecord, stepsRecord } = stepUnderFake({ exit: 3 });
  await openStep("x").done();
  expect(readFileSync(renderRecord, "utf8")).toContain(`"bg":"auto"`);
  expect(readFileSync(stepsRecord, "utf8")).toContain(`{"bg":"auto"}`);
});

test("under the test preload a step runs no settling render", async () => {
  process.env.RT_UI_NO_TERMINAL_QUERY = preloadBlock;
  const { renderRecord, stepsRecord } = stepUnderFake({ renderErr: "background=light\n" });
  await openStep("x").done();
  expect(readFileSync(renderRecord, "utf8")).not.toContain(`{"argv"`);
  expect(readFileSync(stepsRecord, "utf8")).toBe("{}\n");
});
