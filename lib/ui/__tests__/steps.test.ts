import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createStepRunner, withSpinner, __test__ } from "../steps.ts";
import * as layer from "../out.ts";
import { captureOut, type CapturedOut } from "./capture-out.ts";
import { openStep, type StepHandle } from "../spawn.ts";

const FAKE = resolve(import.meta.dir, "fake-rt-ui.ts");
let dir: string;
let record: string;
let io: CapturedOut;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-ui-steps-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  // bun test's stdin is not a TTY, so the real gate would never spawn; force
  // it open here and closed only in the test that is about the gate.
  __test__.setInteractive(() => true);
  io = captureOut();
  layer.__test__.reset();
  layer.__test__.setHuman(() => false);
});
afterEach(() => {
  io.restore();
  __test__.setInteractive(undefined);
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("run streams start/done with the done title and hint, and returns the task result", async () => {
  const steps = createStepRunner();
  const r = await steps.run("fetching origin…", async () => 42, { done: "origin fetched", doneHint: "3 new commits" });
  expect(r).toBe(42);
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "fetching origin…" },
    { t: "done", title: "origin fetched", hint: "3 new commits" },
  ]);
});

test("run streams fail with the error message and rethrows", async () => {
  const steps = createStepRunner();
  await expect(steps.run("pushing…", async () => { throw new Error("rejected"); })).rejects.toThrow("rejected");
  expect(sent().at(-1)).toEqual({ t: "fail", title: "pushing failed", hint: "rejected" });
});

test("done title defaults to the pending title without its ellipsis", async () => {
  const steps = createStepRunner();
  await steps.run("rebasing…", async () => undefined);
  expect(sent().at(-1)).toEqual({ t: "done", title: "rebasing" });
});

test("withSpinner maps doneLabel/failLabel", async () => {
  await withSpinner("fetching origin…", async () => 1, { doneLabel: "origin fetched" });
  expect(sent().at(-1)).toEqual({ t: "done", title: "origin fetched" });
  // failLabel is the failure title, never a hint under the success title.
  await withSpinner("pushing…", async () => { throw new Error("rejected"); }, { doneLabel: "pushed", failLabel: "push rejected" }).catch(() => {});
  expect(sent().at(-1)).toEqual({ t: "fail", title: "push rejected", hint: "rejected" });
});

test("with the gate closed nothing is spawned and the final line prints through the layer", async () => {
  __test__.setInteractive(undefined);
  process.env.RT_BATCH = "1";
  try {
    const steps = createStepRunner();
    await steps.run("Fetching from origin…", async () => 1, { done: "Fetched from origin", doneHint: "3 new commits" });
  } finally {
    delete process.env.RT_BATCH;
  }
  expect(() => readFileSync(record)).toThrow();
  expect(io.stdout()).toBe("[ok] Fetched from origin  3 new commits\n");
  expect(io.stderr()).toBe("");
});

test("off a terminal a step that throws prints a failed line and rethrows", async () => {
  __test__.setInteractive(() => false);
  const steps = createStepRunner();
  await expect(steps.run("Pushing…", async () => { throw new Error("rejected\nby the remote"); }, { error: "Could not push" })).rejects.toThrow("rejected");
  expect(io.stdout()).toBe("[failed] Could not push  rejected by the remote\n");
});

test("a step that fails silently erases itself, draws no failed line, and rethrows", async () => {
  const steps = createStepRunner();
  await expect(steps.run("Pushing…", async () => { throw new Error("rejected"); }, { done: "Pushed", failSilently: true })).rejects.toThrow("rejected");
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "Pushing…" },
    { t: "done", title: "Pushing…", status: "failed", clear: true },
  ]);
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("");
});

test("off a terminal a step that fails silently prints nothing and rethrows", async () => {
  __test__.setInteractive(() => false);
  await expect(withSpinner("Fetching from origin…", async () => { throw new Error("gone"); }, { failSilently: true })).rejects.toThrow("gone");
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("");
});

test("failing silently leaves a step that works ending as it always did", async () => {
  __test__.setInteractive(() => false);
  await createStepRunner().run("Pushing…", async () => 1, { done: "Pushed", failSilently: true });
  expect(io.stdout()).toBe("[ok] Pushed\n");
});

test("under a payload verb the step's plain line goes to stderr", async () => {
  __test__.setInteractive(() => false);
  layer.payloadOnStdout();
  await createStepRunner().run("Fetching from origin…", async () => 1, { done: "Fetched from origin" });
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("[ok] Fetched from origin\n");
});

test("the step lines carry no escape of their own", async () => {
  __test__.setInteractive(() => false);
  await createStepRunner().run("Fetching from origin…", async () => 1, { done: "Fetched from origin" });
  expect(io.stdout()).not.toContain("\x1b[");
});

test("the real gate is closed off a TTY and under RT_BATCH", () => {
  __test__.setInteractive(undefined);
  expect(__test__.interactive()).toBe(Boolean(process.stdin.isTTY));
  process.env.RT_BATCH = "1";
  try {
    expect(__test__.interactive()).toBe(false);
  } finally {
    delete process.env.RT_BATCH;
  }
});

test("an unspawnable helper costs the spinner, not the work", async () => {
  process.env.RT_UI_BIN = join(dir, "does-not-exist", "rt-ui");
  let ran = false;
  const steps = createStepRunner();
  const r = await steps.run("Fetching from origin…", async () => { ran = true; return 42; }, { done: "Fetched from origin" });
  expect(r).toBe(42);
  expect(ran).toBe(true);
  expect(io.stdout()).toBe("[ok] Fetched from origin\n");
  expect(io.stderr()).toBe("[warning] rt could not draw a progress line  results still print\n");
});

test("when the child dies mid-step the final line still prints, with one warning", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
  const steps = createStepRunner();
  const r = await steps.run("Pushing…", async () => { await Bun.sleep(150); return "ok"; }, { done: "Pushed" });
  expect(r).toBe("ok");
  expect(io.stdout()).toBe("[ok] Pushed\n");
  expect(io.stderr()).toBe("[warning] rt could not draw a progress line  results still print\n");
});

test("run hands the task a sub callback that streams sub events before done", async () => {
  const steps = createStepRunner();
  await steps.run(
    "connecting…",
    async (step) => {
      step.sub("checking the session");
      step.sub("opening the tunnel");
    },
    { done: "connected" },
  );
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "connecting…" },
    { t: "sub", text: "checking the session" },
    { t: "sub", text: "opening the tunnel" },
    { t: "done", title: "connected" },
  ]);
});

test("off a terminal the sub callback is a no-op and the final line still prints", async () => {
  __test__.setInteractive(() => false);
  const steps = createStepRunner();
  await steps.run("connecting…", async (step) => step.sub("checking"), { done: "connected" });
  expect(io.stdout()).toBe("[ok] connected\n");
});

test("a step can end in a status other than done", async () => {
  const step = openStep("connecting Slack…");
  await step.done("Slack", "not connected", "needs-you");
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "connecting Slack…" },
    { t: "done", title: "Slack", hint: "not connected", status: "needs-you" },
  ]);
});

test("done takes every status but failed, which only fail may end with", () => {
  const done: StepHandle["done"] = async () => true;
  // @ts-expect-error
  void done("x", undefined, "failed");
  void done("x", undefined, "warn");
});

test("the runner has no log of its own: a line between steps is out.print", () => {
  expect(Object.keys(createStepRunner())).toEqual(["run"]);
});
