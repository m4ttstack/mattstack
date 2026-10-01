import { test, expect, afterEach } from "bun:test";
import { UserActionableError } from "../../errors.ts";
import { exitWithUserError, userFailure } from "../user-failure.ts";
import * as out from "../../ui/out.ts";
import { captureOut, type CapturedOut } from "../../ui/__tests__/capture-out.ts";

let cap: CapturedOut | null = null;
afterEach(() => {
  cap?.restore();
  cap = null;
});

/** The gate is the caller's: closed, so the failure block is plain text and rt-ui is never spawned. */
function capture(): CapturedOut {
  const c = captureOut();
  out.__test__.setHuman(() => false);
  return c;
}

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("userFailure is phase 2's block, with the caller's plainer words laid over it", () => {
  const err = new UserActionableError("bad-path", "/tmp/x does not exist");
  expect(userFailure(err)).toEqual({ title: "/tmp/x does not exist" });
  expect(userFailure(err, { title: "That folder does not exist", next: out.cmd("rt setup repo-root set <folder>") })).toEqual({
    title: "That folder does not exist",
    next: { text: "rt setup repo-root set <folder>", role: "command" },
  });
});

test("an error carrying why and next keeps them under an overlaid title", () => {
  const err = new UserActionableError("not-ready", "Not ready: tools missing", {}, { why: "Apple's Command Line Tools are not installed", next: "rt tools install apple-clt" });
  expect(userFailure(err, { title: "This Mac is not ready to install yet" })).toEqual({
    title: "This Mac is not ready to install yet",
    why: "Apple's Command Line Tools are not installed",
    next: { text: "rt tools install apple-clt", role: "command" },
  });
});

test("exitWithUserError under --json writes the envelope on stdout and nothing on stderr, then exits 2", () => {
  cap = capture();
  const exits: number[] = [];
  const written: unknown[] = [];
  const sink = { json: (v: unknown) => written.push(v), exit: ((code: number) => { exits.push(code); throw new Error("exit"); }) as (code: number) => never, now: () => NOW };
  expect(() => exitWithUserError(new UserActionableError("usage", "usage: rt x"), true, sink)).toThrow("exit");
  expect(written).toEqual([{ contract: 1, at: "2026-01-01T00:00:00.000Z", error: { code: "usage", message: "usage: rt x" } }]);
  expect(cap.stderr()).toBe("");
  expect(exits).toEqual([2]);
});

test("exitWithUserError for a person writes a failure block on stderr, nothing on stdout, then exits 2", () => {
  cap = capture();
  const exits: number[] = [];
  const sink = { json: () => { throw new Error("json must not be called"); }, exit: ((code: number) => { exits.push(code); throw new Error("exit"); }) as (code: number) => never, now: () => NOW };
  expect(() => exitWithUserError(new UserActionableError("usage", "usage: rt x"), false, sink, { title: "Which row?", next: out.cmd("rt setup waive <row-id>") })).toThrow("exit");
  expect(cap.stdout()).toBe("");
  expect(cap.stderr()).toBe("[failed] Which row?\n  next: rt setup waive <row-id>\n");
  expect(exits).toEqual([2]);
});
