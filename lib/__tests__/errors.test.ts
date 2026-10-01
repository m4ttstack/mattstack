import { test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { UserActionableError, exitFromDispatch, exitUnexpected, exitUserError, failureFor, userErrorPayload } from "../errors.ts";
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

const UNEXPECTED_HEAD = "[failed] rt hit an unexpected error  kaboom\n  next: rt daemon logs\n";

/** Runs fn with --json on argv, the way the real gate and the seam see it. */
function withJsonArgv(fn: () => void): void {
  const argv = process.argv;
  process.argv = [...argv, "--json"];
  try {
    fn();
  } finally {
    process.argv = argv;
  }
}

test("exitFromDispatch: an expected failure is the same block as exitUserError, exit 2", () => {
  expect(() => exitFromDispatch(teamError())).toThrow("exit 2");
  expect(captured.stdout()).toBe("");
  expect(captured.stderr()).toBe(
    "[failed] This Mac cannot read the acme team's secrets yet\n" +
      "  why: No age key on this Mac matches the team's recipients.\n" +
      "  next: rt team pull\n" +
      "  the full output is in the rt log\n",
  );
  expect(lastCliLogLine().module).toBe("errors");
});

test("exitFromDispatch: an expected failure under --json is the envelope on stdout, nothing on stderr, exit 2", () => {
  withJsonArgv(() => expect(() => exitFromDispatch(teamError())).toThrow("exit 2"));
  expect(captured.stderr()).toBe("");
  expect(captured.lines()).toHaveLength(1);
  const { at, ...body } = JSON.parse(captured.stdout());
  expect(typeof at).toBe("string");
  expect(body).toEqual({ contract: 1, error: { code: "team-secrets-unreadable", message: "This Mac cannot read the acme team's secrets yet", team: "acme" } });
  expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(2);
});

test("exitFromDispatch: an unexpected error under --json still writes nothing to stdout", () => {
  withJsonArgv(() => expect(() => exitFromDispatch(new Error("kaboom"))).toThrow("exit 1"));
  expect(captured.stdout()).toBe("");
  expect(captured.stderr().startsWith(UNEXPECTED_HEAD)).toBe(true);
});

test("exitFromDispatch: anything else is one line with the message as hint and the stack shown off a terminal, exit 1", () => {
  expect(() => exitFromDispatch(new Error("kaboom"))).toThrow("exit 1");
  expect(captured.stdout()).toBe("");
  const text = captured.stderr();
  expect(text.startsWith(UNEXPECTED_HEAD + "stack:\n  Error: kaboom\n")).toBe(true);
  expect(text).toContain("      at ");
  expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
});

test("exitUnexpected writes the message and stack to the cli log", () => {
  expect(() => exitUnexpected(new Error("kaboom in the log"))).toThrow("exit 1");
  const entry = lastCliLogLine();
  expect(entry.level).toBe("error");
  expect(entry.module).toBe("cli");
  expect(entry.msg).toBe("kaboom in the log");
  expect(String(entry.stack)).toContain("Error: kaboom in the log");
  expect(String(entry.stack)).toContain("    at ");
});

test("a thrown non-Error has no stack: the hint is its text and the excerpt repeats it", () => {
  expect(() => exitUnexpected("boom")).toThrow("exit 1");
  expect(captured.stderr()).toBe("[failed] rt hit an unexpected error  boom\n  next: rt daemon logs\nstack:\n  boom\n");
});

test("a multi-line message gives a one-line hint", () => {
  expect(() => exitUnexpected(new Error("sops -d /x/rt.json: Failed to get the data key required to decrypt the SOPS file.\n\nGroup 0: FAILED"))).toThrow("exit 1");
  expect(captured.stderr().split("\n")[0]).toBe("[failed] rt hit an unexpected error  sops -d /x/rt.json: Failed to get the data key required to decrypt the SOPS file.");
});

test("escape sequences in a message or stack never reach the terminal", () => {
  const err = new Error("evil\x1b[2Jname");
  err.stack = "Error: evil\x1b[2Jname\n    at run (\x1b[31mboom.ts\x1b[0m:1:7)";
  expect(() => exitUnexpected(err)).toThrow("exit 1");
  expect(captured.stderr()).not.toContain("\x1b[");
  expect(captured.stderr()).toContain("[failed] rt hit an unexpected error  evilname");
  expect(captured.stderr()).toContain("      at run (boom.ts:1:7)");
});

test("at a terminal the stack stays in the log unless RT_LOG_LEVEL=debug", () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-errors-"));
  const record = join(dir, "record.ndjson");
  const savedBin = process.env.RT_UI_BIN;
  const savedFake = process.env.RT_UI_FAKE;
  const savedLevel = process.env.RT_LOG_LEVEL;
  process.env.RT_UI_BIN = resolve(import.meta.dir, "..", "ui", "__tests__", "fake-rt-ui.ts");
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  out.__test__.setHuman(() => true);
  const sentTypes = () => readFileSync(record, "utf8").trim().split("\n").slice(1).map((l) => (JSON.parse(l) as { t: string }).t);
  try {
    delete process.env.RT_LOG_LEVEL;
    expect(() => exitUnexpected(new Error("kaboom"))).toThrow("exit 1");
    expect(sentTypes()).toEqual(["hello", "failure"]);
    expect(captured.stderr()).toBe("STYLED\n");

    rmSync(record, { force: true });
    process.env.RT_LOG_LEVEL = "debug";
    expect(() => exitUnexpected(new Error("kaboom"))).toThrow("exit 1");
    expect(sentTypes()).toEqual(["hello", "failure", "verbatim"]);
  } finally {
    if (savedBin === undefined) delete process.env.RT_UI_BIN;
    else process.env.RT_UI_BIN = savedBin;
    if (savedFake === undefined) delete process.env.RT_UI_FAKE;
    else process.env.RT_UI_FAKE = savedFake;
    if (savedLevel === undefined) delete process.env.RT_LOG_LEVEL;
    else process.env.RT_LOG_LEVEL = savedLevel;
    rmSync(dir, { recursive: true, force: true });
  }
  expect(existsSync(record)).toBe(false);
});
