import { test, expect } from "bun:test";
import { captureOut } from "./capture-out.ts";
import { clearScreen } from "../screen.ts";

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

test("clearScreen clears through stderr at a terminal", () => {
  const io = captureOut();
  try {
    withStderrTTY(true, () => clearScreen());
    expect(io.stderr()).toBe("\x1b[2J\x1b[H");
    expect(io.stdout()).toBe("");
  } finally {
    io.restore();
  }
});

test("clearScreen writes nothing to a pipe", () => {
  const io = captureOut();
  try {
    withStderrTTY(false, () => clearScreen());
    expect(io.stderr()).toBe("");
  } finally {
    io.restore();
  }
});
