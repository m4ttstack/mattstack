import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { createStepEmitter, type StepEmitter } from "../emit.ts";
import type { ApplyEvent, EventId } from "../contract.ts";
import * as out from "../../ui/out.ts";

const FAKE = resolve(import.meta.dir, "..", "..", "ui", "__tests__", "fake-rt-ui.ts");
const LABELS = { done: "Setup is done", needsYou: "Setup needs you", failed: "Setup stopped" };

let dir: string;
let record: string;
let stdout: string[];
let stderr: string[];
let logged: Array<[EventId, string]>;
const realOut = process.stdout.write;
const realErr = process.stderr.write;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-emit-"));
  record = join(dir, "record.ndjson");
  stdout = [];
  stderr = [];
  logged = [];
  process.stdout.write = ((c: string | Uint8Array) => (stdout.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (stderr.push(String(c)), true)) as typeof process.stderr.write;
  out.__test__.setHuman(() => false);
});
afterEach(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  out.__test__.reset();
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

function emitter(interactive: boolean): StepEmitter {
  return createStepEmitter({ labels: LABELS, log: (id, line) => logged.push([id, line]), interactive });
}

const plan: ApplyEvent = {
  event: "plan",
  steps: [
    { id: "path.link", title: "Link rt onto your PATH", kind: "rt" },
    { id: "skills.link", title: "Link skills", kind: "rt" },
    { id: "secrets.write", title: "Write secrets", kind: "rt" },
    { id: "plugins.install", title: "Install plugins", kind: "rt" },
    { id: "repos.clone", title: "Clone your repos", kind: "rt" },
  ],
};

async function drive(e: StepEmitter, events: ApplyEvent[]): Promise<void> {
  for (const ev of events) e.emit(ev);
  await e.flush();
}

const sent = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("off a TTY every final state is one plain line with the step's title, a remedy is a fix callout, and the run ends in a summary", async () => {
  await drive(emitter(false), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "log", id: "path.link", line: "ln -s rt" },
    { event: "step", id: "path.link", state: "done", detail: "linked" },
    { event: "step", id: "skills.link", state: "running" },
    { event: "step", id: "skills.link", state: "skipped", detail: "nothing to link" },
    { event: "step", id: "secrets.write", state: "running" },
    { event: "step", id: "secrets.write", state: "needs-you", detail: "Connect Slack" },
    { event: "step", id: "plugins.install", state: "running" },
    { event: "step", id: "plugins.install", state: "partial", detail: "2 of 3 installed", remedy: "Update Claude Code, then Retry." },
    { event: "done", ok: true },
  ]);
  expect(stdout.join("")).toBe(
    "[ok] Link rt onto your PATH  linked\n" +
      "[skipped] Link skills  nothing to link\n" +
      "[needs you] Write secrets  Connect Slack\n" +
      "[warning] Install plugins  2 of 3 installed\n" +
      "  fix: Update Claude Code, then Retry.\n" +
      "[needs you] Setup needs you  1 done, 1 skipped, 1 needs you, 1 with a caveat\n",
  );
  expect(stderr.join("")).toBe("");
  expect(logged).toEqual([["path.link", "ln -s rt"]]);
});

test("off a TTY a failed step keeps its streamed lines under it and the summary says the run stopped", async () => {
  await drive(emitter(false), [
    plan,
    { event: "step", id: "repos.clone", state: "running" },
    { event: "log", id: "repos.clone", line: "git: fatal: could not read from remote" },
    { event: "step", id: "repos.clone", state: "failed", detail: "clone failed", remedy: "Check your network, then Retry" },
    { event: "done", ok: false, failedStep: "repos.clone" },
  ]);
  expect(stdout.join("")).toBe(
    "[failed] Clone your repos  clone failed\n" +
      "  git: fatal: could not read from remote\n" +
      "  fix: Check your network, then Retry\n" +
      "[failed] Setup stopped  1 failed\n",
  );
});

test("a hostile log line prints as one plain row and reaches the log unchanged", async () => {
  const hostile = "line one\nline two\x1b[2J\u0000\tx";
  await drive(emitter(false), [
    plan,
    { event: "step", id: "repos.clone", state: "running" },
    { event: "log", id: "repos.clone", line: hostile },
    { event: "step", id: "repos.clone", state: "failed", detail: "clone failed" },
    { event: "done", ok: false, failedStep: "repos.clone" },
  ]);
  const rows = stdout.join("").split("\n");
  expect(rows[1]).toBe("  line one");
  expect(rows[2]).toBe("  line two\tx");
  expect(stdout.join("")).not.toContain("\x1b[");
  expect(logged).toEqual([["repos.clone", hostile]]);
});

test("at a terminal each step is one rt-ui spawn: start with the title, sub for every log line, done carrying the status", async () => {
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  await drive(emitter(true), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "log", id: "path.link", line: "ln -s rt" },
    { event: "step", id: "path.link", state: "done", detail: "linked" },
    { event: "step", id: "secrets.write", state: "running" },
    { event: "need", id: "secrets.write", request: { type: "app-privileged", op: "proxy-install" } },
    { event: "step", id: "secrets.write", state: "needs-you", detail: "Connect Slack" },
    { event: "done", ok: true },
  ]);
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "Link rt onto your PATH" },
    { t: "sub", text: "ln -s rt" },
    { t: "done", title: "Link rt onto your PATH", hint: "linked" },
    { t: "hello", protocol: 1 },
    { t: "start", title: "Write secrets" },
    { t: "sub", text: "Waiting for mattstack.app to finish this step" },
    { t: "done", title: "Write secrets", hint: "Connect Slack", status: "needs-you" },
  ]);
  expect(stdout.join("")).toBe("[needs you] Setup needs you  1 done, 1 needs you\n");
  expect(logged).toEqual([["path.link", "ln -s rt"], ["secrets.write", "Waiting for mattstack.app to finish this step"]]);
});

test("at a terminal a failed step ends with fail, and partial ends with warn", async () => {
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  await drive(emitter(true), [
    plan,
    { event: "step", id: "plugins.install", state: "running" },
    { event: "step", id: "plugins.install", state: "partial", detail: "2 of 3", remedy: "Retry" },
    { event: "step", id: "repos.clone", state: "running" },
    { event: "step", id: "repos.clone", state: "failed", detail: "clone failed" },
    { event: "done", ok: false, failedStep: "repos.clone" },
  ]);
  expect(sent().filter((m) => m.t === "done" || m.t === "fail")).toEqual([
    { t: "done", title: "Install plugins", hint: "2 of 3", status: "warn" },
    { t: "fail", title: "Clone your repos", hint: "clone failed" },
  ]);
  expect(stdout.join("")).toBe("  fix: Retry\n[failed] Setup stopped  1 with a caveat, 1 failed\n");
});

test("a helper that dies on start leaves the run on the plain path", async () => {
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record, dieOn: "start" });
  await drive(emitter(true), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "step", id: "path.link", state: "done", detail: "linked" },
    { event: "done", ok: true },
  ]);
  expect(stdout.join("")).toBe("[ok] Link rt onto your PATH  linked\n[ok] Setup is done  1 done\n");
});

test("a helper that cannot start leaves the run on the plain path", async () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  await drive(emitter(true), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "step", id: "path.link", state: "done" },
    { event: "done", ok: true },
  ]);
  expect(stdout.join("")).toBe("[ok] Link rt onto your PATH\n[ok] Setup is done  1 done\n");
});

test("a log line with no step open is a warning line without its warn prefix", async () => {
  await drive(emitter(false), [{ event: "log", id: "verify", line: "warn: setup state not persisted: disk full" }]);
  expect(stdout.join("")).toBe("[warning] setup state not persisted: disk full\n");
  expect(logged).toEqual([["verify", "warn: setup state not persisted: disk full"]]);
});

test("a skipped run is one skipped line", async () => {
  await drive(emitter(false), [{ event: "done", ok: true, skipped: "current" }]);
  expect(stdout.join("")).toBe("[skipped] Nothing to update\n");
});

test("a tip raised while a step runs is a tip callout under that step's line", async () => {
  const e = emitter(false);
  e.emit(plan);
  e.emit({ event: "step", id: "path.link", state: "running" });
  e.tip("path.link", "Saved on this Mac only.");
  e.emit({ event: "step", id: "path.link", state: "done", detail: "linked" });
  e.emit({ event: "done", ok: true });
  await e.flush();
  expect(stdout.join("")).toBe("[ok] Link rt onto your PATH  linked\n  tip: Saved on this Mac only.\n[ok] Setup is done  1 done\n");
  expect(logged).toEqual([["path.link", "Saved on this Mac only."]]);
});

test("an id the plan never named falls back to the id", async () => {
  await drive(emitter(false), [
    { event: "step", id: "path.link", state: "running" },
    { event: "step", id: "path.link", state: "done" },
    { event: "done", ok: true },
  ]);
  expect(stdout.join("")).toBe("[ok] path.link\n[ok] Setup is done  1 done\n");
});

test("at a terminal a hostile detail reaches the helper as one clean line, on a done step and on a failed one", async () => {
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const hostile = "first\x1b[2Jsecond\nforged row\x1b]0;title\x07\u0000end";
  await drive(emitter(true), [
    plan,
    { event: "step", id: "path.link", state: "running" },
    { event: "step", id: "path.link", state: "done", detail: hostile },
  ]);
  await drive(emitter(true), [
    plan,
    { event: "step", id: "repos.clone", state: "running" },
    { event: "step", id: "repos.clone", state: "failed", detail: hostile },
  ]);
  const ends = sent().filter((m) => m.t === "done" || m.t === "fail");
  expect(ends.map((m) => m.t)).toEqual(["done", "fail"]);
  for (const m of ends) {
    expect(m.hint).toBe("firstsecond forged rowend");
    expect(m.hint).not.toMatch(/[\x00-\x1f]/);
  }
});

test("at a terminal a log line with a newline is one sub per row and the log receives it unchanged", async () => {
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const hostile = "line one\nline two";
  await drive(emitter(true), [
    plan,
    { event: "step", id: "repos.clone", state: "running" },
    { event: "log", id: "repos.clone", line: hostile },
    { event: "step", id: "repos.clone", state: "done" },
  ]);
  expect(sent().filter((m) => m.t === "sub")).toEqual([
    { t: "sub", text: "line one" },
    { t: "sub", text: "line two" },
  ]);
  expect(logged).toEqual([["repos.clone", hostile]]);
});
