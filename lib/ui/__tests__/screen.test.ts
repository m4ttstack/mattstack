import { test, expect, beforeEach, afterEach } from "bun:test";
import * as out from "../out.ts";
import { captureOut } from "./capture-out.ts";
import { clearScreen } from "../screen.ts";

let io: ReturnType<typeof captureOut>;

beforeEach(() => {
  io = captureOut();
});
afterEach(() => {
  io.restore();
  out.__test__.reset();
});

function withStderrTTY(value: boolean, fn: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true });
  try {
    fn();
  } finally {
    if (descriptor) Object.defineProperty(process.stderr, "isTTY", descriptor);
    else delete (process.stderr as { isTTY?: boolean }).isTTY;
  }
}

test("clearScreen clears through stderr when a person reads stderr", () => {
  out.__test__.setHuman((stream) => stream === "stderr");
  clearScreen();
  expect(io.stderr()).toBe("\x1b[2J\x1b[H");
  expect(io.stdout()).toBe("");
});

test("clearScreen writes nothing when nobody reads stderr", () => {
  out.__test__.setHuman(() => false);
  clearScreen();
  expect(io.stderr()).toBe("");
});

test("clearScreen writes nothing under --json, even with stderr at a terminal", () => {
  const argv = process.argv;
  const batch = process.env.RT_BATCH;
  delete process.env.RT_BATCH;
  process.argv = [...argv, "--json"];
  try {
    withStderrTTY(true, () => clearScreen());
  } finally {
    process.argv = argv;
    if (batch !== undefined) process.env.RT_BATCH = batch;
  }
  expect(io.stderr()).toBe("");
});

test("clearScreen writes nothing under RT_BATCH, even with stderr at a terminal", () => {
  const batch = process.env.RT_BATCH;
  process.env.RT_BATCH = "1";
  try {
    withStderrTTY(true, () => clearScreen());
  } finally {
    if (batch === undefined) delete process.env.RT_BATCH;
    else process.env.RT_BATCH = batch;
  }
  expect(io.stderr()).toBe("");
});
