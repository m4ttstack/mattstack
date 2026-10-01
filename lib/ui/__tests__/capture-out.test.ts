import { afterEach, describe, expect, test } from "bun:test";
import * as out from "../out.ts";
import { captureOut, type CapturedOut } from "./capture-out.ts";

describe("captureOut", () => {
  let cap: CapturedOut | undefined;

  afterEach(() => {
    cap?.restore();
    cap = undefined;
  });

  test("console: true routes console.log and console.error into the buffers", () => {
    const realLog = console.log;
    const realError = console.error;
    cap = captureOut({ console: true });
    console.log("one", 2);
    console.error("bad", "thing");
    expect(cap.stdout()).toBe("one 2\n");
    expect(cap.stderr()).toBe("bad thing\n");
    cap.restore();
    cap = undefined;
    expect(console.log).toBe(realLog);
    expect(console.error).toBe(realError);
  });

  test("clear() empties the buffers without touching the stream", () => {
    cap = captureOut();
    out.__test__.setHuman(() => false);
    out.payloadOnStdout();
    out.print(out.line("done", "first"));
    expect(cap.stderr()).toContain("first");
    cap.clear();
    expect(cap.stderr()).toBe("");
    out.print(out.line("done", "second"));
    expect(cap.stderr()).toContain("second");
    expect(cap.stderr()).not.toContain("first");
    expect(cap.stdout()).toBe("");
  });
});
