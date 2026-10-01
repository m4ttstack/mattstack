/**
 * A cold fetch draws one spinner, the Go step, and leaves nothing behind;
 * a silent fetch (a picker is already on screen) draws none.
 */
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { enrichBranches } from "../enrich.ts";
import * as daemonClient from "../daemon-client.ts";
import * as linearModule from "../linear.ts";
import * as out from "../ui/out.ts";
import { __test__ as gate } from "../ui/gate.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const FAKE = resolve(import.meta.dir, "..", "ui", "__tests__", "fake-rt-ui.ts");
let dir: string;
let record: string;
let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-enrich-step-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  io = captureOut();
  io.reset();
  out.__test__.setHuman(() => false);
  gate.setInteractive(() => true);
  spyOn(daemonClient, "daemonQuery").mockResolvedValue(null as never);
  spyOn(linearModule, "loadSecrets").mockResolvedValue({ linearApiKey: "invented-key" } as never);
});
afterEach(() => {
  io.restore();
  mock.restore();
  gate.setInteractive(undefined);
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a cold fetch runs under a step that is cleared, and writes nothing to stderr", async () => {
  const result = await enrichBranches([{ path: "/x/one", branch: "spinner-probe/cold" }]);

  expect(result.map((r) => r.branch)).toEqual(["spinner-probe/cold"]);
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "Fetching branch info" },
    { t: "done", title: "Fetching branch info", clear: true },
  ]);
  expect(io.stderr()).toBe("");
  expect(io.stdout()).toBe("");
});

test("a silent fetch draws nothing", async () => {
  await enrichBranches([{ path: "/x/two", branch: "spinner-probe/silent" }], undefined, { silent: true });
  expect(existsSync(record)).toBe(false);
  expect(io.stderr()).toBe("");
});

test("with no token there is nothing to wait for, so no step", async () => {
  mock.restore();
  spyOn(daemonClient, "daemonQuery").mockResolvedValue(null as never);
  spyOn(linearModule, "loadSecrets").mockResolvedValue({} as never);
  await enrichBranches([{ path: "/x/three", branch: "spinner-probe/no-token" }]);
  expect(existsSync(record)).toBe(false);
});

test("a missing helper costs the spinner, never the data", async () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  const result = await enrichBranches([{ path: "/x/four", branch: "spinner-probe/no-helper" }]);
  expect(result.map((r) => r.branch)).toEqual(["spinner-probe/no-helper"]);
});
