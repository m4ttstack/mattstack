import { test, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { BackNavigation } from "../../back-navigation.ts";
import * as bg from "../background.ts";
import { runPrompt, openStep, settleBackground, __test__ } from "../spawn.ts";
import type { PromptSpec } from "../protocol.ts";

const FAKE = resolve(import.meta.dir, "fake-rt-ui.ts");
let dir: string;
let record: string;
const exits: number[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-ui-spawn-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  exits.length = 0;
  __test__.setExit((code) => {
    exits.push(code);
    throw new Error(`exit ${code}`);
  });
});

afterEach(() => {
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  __test__.setExit(undefined);
  rmSync(dir, { recursive: true, force: true });
});

const spec: PromptSpec = { t: "prompt", protocol: 1, kind: "select", title: "Pick", options: [{ value: "a", label: "A" }] };

test("runPrompt sends exactly one spec line and returns the parsed result", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ answer: { value: "a" }, record });
  const r = await runPrompt(spec);
  expect(r).toEqual({ t: "result", value: "a" });
  const sent = readFileSync(record, "utf8").trim().split("\n");
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]!)).toEqual(spec);
});

test("runPrompt keeps stdin open until the child exits", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ answer: { value: "a" }, holdMs: 300 });
  const t0 = Date.now();
  await runPrompt(spec);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
});

test("exit 130 maps to process.exit(130)", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ exit: 130 });
  await expect(runPrompt(spec)).rejects.toThrow("exit 130");
  expect(exits).toEqual([130]);
});

test("exit 131 throws BackNavigation", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ exit: 131 });
  await expect(runPrompt(spec)).rejects.toBeInstanceOf(BackNavigation);
});

test("exit 2 and 70 exit 1 with a message naming the binary", async () => {
  for (const code of [2, 70]) {
    process.env.RT_UI_FAKE = JSON.stringify({ exit: code });
    await expect(runPrompt(spec)).rejects.toThrow("exit 1");
  }
  expect(exits).toEqual([1, 1]);
});

test("openStep streams hello, start, log, done and resolves on child exit", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const step = openStep("fetching origin…");
  step.log("warn", "diverged");
  await step.done("origin fetched", "3 new commits");
  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(sent).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "fetching origin…" },
    { t: "log", level: "warn", text: "diverged" },
    { t: "done", title: "origin fetched", hint: "3 new commits" },
  ]);
});

test("openStep resolves true when the child painted the final line", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const step = openStep("pushing…");
  expect(await step.done("pushed")).toBe(true);
});

test("openStep resolves false, never throws or exits, when the child died mid-step", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
  const step = openStep("pushing…");
  await Bun.sleep(150);
  step.log("info", "still going");
  expect(await step.done("pushed")).toBe(false);
  expect(exits).toEqual([]);
});

test("clear ends the step with a done event that carries the label and clear", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const step = openStep("scanning ports…");
  expect(await step.clear()).toBe(true);
  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(sent).toEqual([{ t: "hello", protocol: 1 }, { t: "start", title: "scanning ports…" }, { t: "done", title: "scanning ports…", clear: true }]);
});

test("a clear after a throw carries the failed status for a helper that predates the flag", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const step = openStep("pushing…");
  expect(await step.clear({ thrown: true })).toBe(true);
  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(sent.at(-1)).toEqual({ t: "done", title: "pushing…", status: "failed", clear: true });
});

test("done never carries clear", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const step = openStep("pushing…");
  await step.done("pushed");
  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(sent.at(-1)).toEqual({ t: "done", title: "pushed" });
});

test("clear resolves false, never throws, when the child died mid-step", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
  const step = openStep("scanning ports…");
  await Bun.sleep(150);
  expect(await step.clear()).toBe(false);
  expect(exits).toEqual([]);
});

test("settles at most once when no answer comes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-settle-"));
  const record = join(dir, "record.ndjson");
  const saved = { bin: process.env.RT_UI_BIN, fake: process.env.RT_UI_FAKE, noQuery: process.env.RT_UI_NO_TERMINAL_QUERY };
  process.env.RT_UI_BIN = join(import.meta.dir, "fake-rt-ui.ts");
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  delete process.env.RT_UI_NO_TERMINAL_QUERY;
  bg.__test__.reset();
  bg.__test__.setRead(() => "auto");
  bg.__test__.setTTY(() => true);
  try {
    await settleBackground();
    await settleBackground();
    await settleBackground();
    const hellos = readFileSync(record, "utf8").trim().split("\n").filter((l) => JSON.parse(l).t === "hello");
    expect(hellos).toHaveLength(1);
  } finally {
    bg.__test__.reset();
    for (const [k, v] of [["RT_UI_BIN", saved.bin], ["RT_UI_FAKE", saved.fake], ["RT_UI_NO_TERMINAL_QUERY", saved.noQuery]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent background settling callers wait for the same query", async () => {
  const fake = join(dir, "controlled-rt-ui.ts");
  const socketPath = join(dir, "query.sock");
  let connected!: (socket: Socket) => void;
  const connection = new Promise<Socket>((resolve) => { connected = resolve; });
  const server = createServer(connected);
  await new Promise<void>((resolve) => { server.listen(socketPath, resolve); });
  writeFileSync(fake, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { createConnection } from "node:net";
appendFileSync(${JSON.stringify(record)}, await Bun.stdin.text());
const socket = createConnection(${JSON.stringify(socketPath)});
socket.once("data", () => process.exit(0));
`);
  chmodSync(fake, 0o755);
  const savedNoQuery = process.env.RT_UI_NO_TERMINAL_QUERY;
  process.env.RT_UI_BIN = fake;
  delete process.env.RT_UI_NO_TERMINAL_QUERY;
  bg.__test__.reset();
  bg.__test__.setRead(() => "auto");
  bg.__test__.setTTY(() => true);
  let firstResolved = false;
  let secondResolved = false;
  const first = settleBackground().then(() => { firstResolved = true; });
  const socket = await connection;
  const second = settleBackground().then(() => { secondResolved = true; });
  try {
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);
  } finally {
    socket.end("release");
    await Promise.all([first, second]);
    server.close();
    bg.__test__.reset();
    if (savedNoQuery === undefined) delete process.env.RT_UI_NO_TERMINAL_QUERY;
    else process.env.RT_UI_NO_TERMINAL_QUERY = savedNoQuery;
  }
  expect(firstResolved).toBe(true);
  expect(secondResolved).toBe(true);
  const hellos = readFileSync(record, "utf8").trim().split("\n").filter((line) => JSON.parse(line).t === "hello");
  expect(hellos).toHaveLength(1);
});
