import { test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { UserActionableError, exitUserError, failureFor, userErrorPayload } from "../errors.ts";
import { UserActionableError as ViaShim, exitUserError as exitViaShim, userErrorPayload as payloadViaShim } from "../setup/errors.ts";
import { logsDir } from "../rt-paths.ts";
import * as out from "../ui/out.ts";
import { captureOut } from "../ui/__tests__/capture-out.ts";

let captured: ReturnType<typeof captureOut>;
let exitSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  captured = captureOut();
  out.__test__.setHuman(() => false);
  exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as never);
});
afterEach(() => {
  captured.restore();
  exitSpy.mockRestore();
});

function lastCliLogLine(): Record<string, unknown> {
  const dir = logsDir();
  const file = readdirSync(dir).filter((f) => f.startsWith("cli.") && f.endsWith(".log")).sort().at(-1);
  if (!file) throw new Error("no cli log was written");
  const lines = readFileSync(join(dir, file), "utf8").trim().split("\n");
  return JSON.parse(lines.at(-1)!) as Record<string, unknown>;
}

const teamError = () =>
  new UserActionableError("team-secrets-unreadable", "This Mac cannot read the acme team's secrets yet", { team: "acme" }, {
    why: "No age key on this Mac matches the team's recipients.",
    next: "rt team pull",
    log: "sops -d /x/board.json: Failed to get the data key required to decrypt the SOPS file.",
  });

test("carries why, next and log beside the contract fields, all optional", () => {
  const err = teamError();
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe("team-secrets-unreadable");
  expect(err.message).toBe("This Mac cannot read the acme team's secrets yet");
  expect(err.extra).toEqual({ team: "acme" });
  expect(err.why).toBe("No age key on this Mac matches the team's recipients.");
  expect(err.next).toBe("rt team pull");
  expect(err.log).toContain("sops -d");
  const bare = new UserActionableError("usage", "usage: rt tools install <tool> [--json]");
  expect(bare.extra).toEqual({});
  expect(bare.why).toBeUndefined();
  expect(bare.next).toBeUndefined();
  expect(bare.log).toBeUndefined();
});

test("the --json payload is unchanged: contract, at, and error with code, message and extra only", () => {
  const payload = userErrorPayload(teamError(), new Date("2026-10-01T12:00:00.000Z"));
  expect(payload as unknown).toEqual({
    contract: 1,
    at: "2026-10-01T12:00:00.000Z",
    error: { code: "team-secrets-unreadable", message: "This Mac cannot read the acme team's secrets yet", team: "acme" },
  });
});

test("lib/setup/errors.ts re-exports the same bindings", () => {
  expect(ViaShim).toBe(UserActionableError);
  expect(exitViaShim).toBe(exitUserError);
  expect(payloadViaShim).toBe(userErrorPayload);
});

test("failureFor maps the error onto a failure block", () => {
  expect(failureFor(teamError())).toEqual({
    title: "This Mac cannot read the acme team's secrets yet",
    why: "No age key on this Mac matches the team's recipients.",
    next: { text: "rt team pull", role: "command" },
    details: "the full output is in the rt log",
  });
  expect(failureFor(new UserActionableError("usage", "usage: rt tools install <tool> [--json]"))).toEqual({ title: "usage: rt tools install <tool> [--json]" });
});

test("exitUserError --json hands the envelope line to print when given", () => {
  const lines: string[] = [];
  expect(() => exitUserError(teamError(), true, "team pull", (s) => lines.push(s))).toThrow("exit 2");
  expect(lines).toHaveLength(1);
  const { at, ...body } = JSON.parse(lines[0]!);
  expect(typeof at).toBe("string");
  expect(body).toEqual({ contract: 1, error: { code: "team-secrets-unreadable", message: "This Mac cannot read the acme team's secrets yet", team: "acme" } });
  expect(captured.stdout()).toBe("");
  expect(captured.stderr()).toBe("");
});

test("exitUserError --json without print writes the same line on stdout", () => {
  expect(() => exitUserError(teamError(), true, "team pull")).toThrow("exit 2");
  const written = captured.stdout();
  expect(written.endsWith("\n")).toBe(true);
  expect(JSON.parse(written).error.code).toBe("team-secrets-unreadable");
  expect(written.split("\n")).toHaveLength(2);
  expect(captured.stderr()).toBe("");
});

test("exitUserError without --json draws the failure on stderr with no verb prefix and exits 2", () => {
  expect(() => exitUserError(teamError(), false, "team pull", () => { throw new Error("print must not be used for a human failure"); })).toThrow("exit 2");
  expect(captured.stdout()).toBe("");
  expect(captured.stderr()).toBe(
    "[failed] This Mac cannot read the acme team's secrets yet\n" +
      "  why: No age key on this Mac matches the team's recipients.\n" +
      "  next: rt team pull\n" +
      "  the full output is in the rt log\n",
  );
  expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(2);
});

test("a log detail lands in the cli log, never on screen", () => {
  expect(() => exitUserError(teamError(), false, "team pull")).toThrow("exit 2");
  expect(captured.stderr()).not.toContain("sops -d");
  const entry = lastCliLogLine();
  expect(entry.level).toBe("warn");
  expect(entry.module).toBe("errors");
  expect(entry.code).toBe("team-secrets-unreadable");
  expect(String(entry.detail)).toContain("sops -d /x/board.json");
});

test("an error with no why or next is one line", () => {
  expect(() => exitUserError(new UserActionableError("usage", "usage: rt tools install <tool> [--json]"), false, "tools install")).toThrow("exit 2");
  expect(captured.stderr()).toBe("[failed] usage: rt tools install <tool> [--json]\n");
});

test("a multi-line message collapses to one title line in plain output", () => {
  const err = new UserActionableError("members-error", "first line\nsecond line");
  expect(() => exitUserError(err, false, "team members sync")).toThrow("exit 2");
  expect(captured.stderr()).toBe("[failed] first line second line\n");
});
