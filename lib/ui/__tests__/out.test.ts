import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import * as out from "../out.ts";

const FAKE = resolve(import.meta.dir, "fake-rt-ui.ts");
let dir: string;
let record: string;
let stdout: string[];
let stderr: string[];
const realOut = process.stdout.write;
const realErr = process.stderr.write;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-out-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  delete process.env.NO_COLOR;
  out.__test__.setHuman(() => true);
  stdout = [];
  stderr = [];
  process.stdout.write = ((c: string | Uint8Array) => (stdout.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (stderr.push(String(c)), true)) as typeof process.stderr.write;
});
afterEach(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  out.__test__.reset();
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  delete process.env.NO_COLOR;
  rmSync(dir, { recursive: true, force: true });
});

const sent = () =>
  readFileSync(record, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

test("builders produce wire blocks and normalize cell input", () => {
  expect(out.line("done", "Skills linked", "16 skills")).toEqual({ t: "line", status: "done", title: "Skills linked", hint: "16 skills" });
  expect(out.line("done", "x")).toEqual({ t: "line", status: "done", title: "x" });
  expect(out.callout("next", out.cmd("rt setup slack connect"), ["then ", out.strong("retry")])).toEqual({
    t: "callout",
    label: "next",
    body: [[{ text: "rt setup slack connect", role: "command" }], [{ text: "then " }, { text: "retry", role: "strong" }]],
  });
  expect(out.table([["a", out.dim("b")], { group: "G" }], ["X", "Y"])).toEqual({
    t: "table",
    headers: ["X", "Y"],
    rows: [{ cells: [[{ text: "a" }], [{ text: "b", role: "dim" }]] }, { group: "G" }],
  });
  expect(out.tree(out.key("root"), [["user", "not set"]])).toEqual({ t: "tree", root: [{ text: "root", role: "key" }], children: [[[{ text: "user" }], [{ text: "not set" }]]] });
  expect(out.section("Accounts", undefined, out.line("done", "GitHub"))).toEqual({ t: "section", title: "Accounts", blocks: [{ t: "line", status: "done", title: "GitHub" }] });
  expect(out.kv("k")).toEqual({ t: "kv", key: "k" });
  expect(out.link("docs", "https://example.com")).toEqual({ text: "docs", role: "link", url: "https://example.com" });
  expect(out.failure({ title: "x", next: out.cmd("rt setup status") })).toEqual({ t: "failure", title: "x", next: [{ text: "rt setup status", role: "command" }] });
});

test("at a terminal print pipes hello plus one block per line to rt-ui render and writes its output to stdout", () => {
  out.print(out.line("done", "Skills linked"), out.callout("tip", "saved"));
  expect(stdout.join("")).toBe("STYLED\n");
  expect(stderr.join("")).toBe("");
  const [head, ...lines] = sent();
  expect(head.argv[0]).toBe("--width");
  expect(head.argv[1]).toMatch(/^\d+$/);
  expect(head.argv).toHaveLength(2);
  expect(lines).toEqual([{ t: "hello", protocol: 1 }, { t: "line", status: "done", title: "Skills linked" }, { t: "callout", label: "tip", body: [[{ text: "saved" }]] }]);
});

test("NO_COLOR is passed to the helper as --no-color", () => {
  process.env.NO_COLOR = "1";
  out.print(out.line("done", "x"));
  expect(sent()[0].argv.at(-1)).toBe("--no-color");
});

test("off a terminal print writes the plain text and never spawns the helper", () => {
  out.__test__.setHuman(() => false);
  out.print(out.line("done", "Skills linked", "16 skills"));
  expect(stdout.join("")).toBe("[ok] Skills linked  16 skills\n");
  expect(existsSync(record)).toBe(false);
});

test("falls back to plain when the helper exits non-zero", () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record, exit: 2 });
  out.print(out.line("done", "Skills linked"));
  expect(stdout.join("")).toBe("[ok] Skills linked\n");
});

test("falls back to plain when the helper cannot be found", () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  out.print(out.line("done", "Skills linked"));
  expect(stdout.join("")).toBe("[ok] Skills linked\n");
});

test("print with no blocks writes nothing", () => {
  out.print();
  expect(stdout.join("")).toBe("");
  expect(existsSync(record)).toBe(false);
});

test("fail renders a failure block on stderr", () => {
  out.__test__.setHuman(() => false);
  out.fail({ title: "This Mac cannot read the team's secrets yet", why: "No key matches." });
  expect(stdout.join("")).toBe("");
  expect(stderr.join("")).toBe("[failed] This Mac cannot read the team's secrets yet\n  why: No key matches.\n");
});

test("the human gate is asked about the stream being written", () => {
  const asked: string[] = [];
  out.__test__.setHuman((stream) => (asked.push(stream), false));
  out.print(out.line("done", "x"));
  out.fail({ title: "y" });
  expect(asked).toEqual(["stdout", "stderr"]);
});

test("the real gate opens only on a TTY, without RT_BATCH and without --json", () => {
  out.__test__.reset();
  const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const argv = process.argv;
  const batch = process.env.RT_BATCH;
  const spawned = (): boolean => {
    const yes = existsSync(record);
    rmSync(record, { force: true });
    return yes;
  };
  const setTTY = (value: boolean) => Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  try {
    delete process.env.RT_BATCH;
    setTTY(false);
    out.print(out.line("done", "x"));
    expect(spawned()).toBe(false);

    setTTY(true);
    out.print(out.line("done", "x"));
    expect(spawned()).toBe(true);

    process.env.RT_BATCH = "1";
    out.print(out.line("done", "x"));
    expect(spawned()).toBe(false);
    delete process.env.RT_BATCH;

    process.argv = [...argv, "--json"];
    out.print(out.line("done", "x"));
    expect(spawned()).toBe(false);
  } finally {
    process.argv = argv;
    if (batch === undefined) delete process.env.RT_BATCH;
    else process.env.RT_BATCH = batch;
    if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
});

test("after payloadOnStdout, print writes human text to stderr and payload still owns stdout", () => {
  out.__test__.setHuman(() => false);
  out.payloadOnStdout();
  out.print(out.line("done", "Installed the shell wrapper"));
  out.payload("/Users/sam/code/app\n");
  expect(stderr.join("")).toBe("[ok] Installed the shell wrapper\n");
  expect(stdout.join("")).toBe("/Users/sam/code/app\n");
});

test("payload writes its text byte for byte and json writes one line", () => {
  out.payload("no newline added");
  out.json({ ok: true, n: 1 });
  out.json({ a: 1 }, 2);
  expect(stdout.join("")).toBe('no newline added{"ok":true,"n":1}\n{\n  "a": 1\n}\n');
});
