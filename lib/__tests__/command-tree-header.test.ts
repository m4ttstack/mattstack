import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { dispatch, type CommandNode } from "../command-tree.ts";
import * as ui from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

const FAKE = resolve(import.meta.dir, "..", "ui", "__tests__", "fake-rt-ui.ts");
const CLEAR = "\x1b[2J\x1b[H";
let dir: string;
let record: string;
let io: ReturnType<typeof captureOut>;
let ttyDescriptor: PropertyDescriptor | undefined;
let batch: string | undefined;
const argv = process.argv;

function stderrIsTTY(value: boolean): void {
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true });
}

// The real gate, with only stderr's isTTY pinned: --json and RT_BATCH must
// close it the way they do for a person's run.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-header-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  batch = process.env.RT_BATCH;
  delete process.env.RT_BATCH;
  io = captureOut();
  ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  stderrIsTTY(true);
});
afterEach(() => {
  process.argv = argv;
  if (ttyDescriptor) Object.defineProperty(process.stderr, "isTTY", ttyDescriptor);
  else delete (process.stderr as { isTTY?: boolean }).isTTY;
  if (batch === undefined) delete process.env.RT_BATCH;
  else process.env.RT_BATCH = batch;
  io.restore();
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const sent = (): Array<Record<string, unknown>> => (existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
// One entry per recorded line: "call" for the argv line that opens each
// render call, then the t of every wire line.
const wire = () => sent().map((l) => (typeof l.t === "string" ? l.t : "call"));

test("at a terminal the breadcrumb is drawn once, on stderr, before the handler runs", async () => {
  let drawnBeforeHandler = "";
  const tree: Record<string, CommandNode> = {
    show: {
      description: "Show it",
      handler: async () => {
        drawnBeforeHandler = io.stderr();
      },
    },
  };
  await dispatch(tree, ["show"]);
  expect(drawnBeforeHandler).toBe(CLEAR + "STYLED\n");
  expect(io.stderr()).toBe(CLEAR + "STYLED\n");
  expect(io.stdout()).toBe("");
  expect(wire()).toEqual(["call", "hello", "section"]);
  expect(sent()[2]).toMatchObject({ t: "section", title: "rt › show" });
});

test("a nested command's breadcrumb names the whole path", async () => {
  const tree: Record<string, CommandNode> = { fruit: { description: "Fruit", subcommands: { peel: { description: "Peel one", handler: async () => {} } } } };
  await dispatch(tree, ["fruit", "peel"]);
  expect(sent()[2]!.title).toBe("rt › fruit › peel");
});

test("with no helper the breadcrumb is one plain line on stderr", async () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  const tree: Record<string, CommandNode> = { show: { description: "Show it", handler: async () => {} } };
  await dispatch(tree, ["show"]);
  expect(io.stderr()).toMatch(/^\x1b\[2J\x1b\[Hrt › show( \(dev mode\))?\n$/);
  expect(io.stdout()).toBe("");
});

test("a fullscreen command draws no breadcrumb", async () => {
  const tree: Record<string, CommandNode> = { board: { description: "Owns the screen", fullscreen: true, handler: async () => {} } };
  await dispatch(tree, ["board"]);
  expect(wire()).toEqual([]);
  expect(io.stderr()).toBe(CLEAR);
});

test("a hidden command draws no breadcrumb: a program runs it, at the person's terminal", async () => {
  const tree: Record<string, CommandNode> = { credential: { description: "Answers git", hidden: true, handler: async () => ui.payload("username=sample\n") } };
  await dispatch(tree, ["credential"]);
  expect(wire()).toEqual([]);
  expect(io.stdout()).toBe("username=sample\n");
  expect(io.stderr()).toBe(CLEAR);
});

test("no breadcrumb when stderr is not a terminal", async () => {
  stderrIsTTY(false);
  const tree: Record<string, CommandNode> = { show: { description: "Show it", handler: async () => {} } };
  await dispatch(tree, ["show"]);
  expect(wire()).toEqual([]);
  expect(io.stderr()).toBe("");
});

test("no breadcrumb under --json", async () => {
  process.argv = [...argv, "--json"];
  const tree: Record<string, CommandNode> = { show: { description: "Show it", handler: async () => ui.json({ ok: true }) } };
  await dispatch(tree, ["show", "--json"]);
  expect(wire()).toEqual([]);
  expect(io.stdout()).toBe('{"ok":true}\n');
});

test("no breadcrumb under RT_BATCH", async () => {
  process.env.RT_BATCH = "1";
  const tree: Record<string, CommandNode> = { show: { description: "Show it", handler: async () => {} } };
  await dispatch(tree, ["show"]);
  expect(wire()).toEqual([]);
});
