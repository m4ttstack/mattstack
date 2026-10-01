import { test, expect, beforeEach, afterEach } from "bun:test";
import * as out from "../out.ts";
import { captureOut } from "./capture-out.ts";
import { warn, setWarningLog, __test__, type WarningLog } from "../warn.ts";

let io: ReturnType<typeof captureOut>;
let logged: Array<{ module: string; message: string; context: Record<string, unknown> }>;
const log: WarningLog = (module, message, context) => {
  logged.push({ module, message, context });
};

beforeEach(() => {
  io = captureOut();
  out.__test__.setHuman(() => false);
  logged = [];
  __test__.reset();
});
afterEach(() => {
  __test__.reset();
  io.restore();
});

const shown = { title: "Your repo folders setting could not be read", hint: "rt is looking in its usual places only", next: out.cmd("rt settings check") };

test("with no log set, a warning is one rt: line on stderr and nothing is shown", () => {
  warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: shown });
  expect(io.stderr()).toBe("rt: rt.repoRoots could not be resolved (boom)\n");
  expect(io.stdout()).toBe("");
});

test("a log-only warning reaches the log and prints nothing", () => {
  setWarningLog(log);
  warn("state", "legacy state file /x/repos.json is corrupt JSON, leaving in place", { context: { path: "/x/repos.json" } });
  expect(logged).toEqual([{ module: "state", message: "legacy state file /x/repos.json is corrupt JSON, leaving in place", context: { path: "/x/repos.json" } }]);
  expect(io.stderr()).toBe("");
  expect(io.stdout()).toBe("");
});

test("a shown warning is logged, then printed once on stderr", () => {
  setWarningLog(log);
  warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: shown });
  warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: shown });
  expect(logged).toHaveLength(2);
  expect(logged[0]!.context).toEqual({});
  expect(io.stderr()).toBe("[warning] Your repo folders setting could not be read  rt is looking in its usual places only\n  next: rt settings check\n");
  expect(io.stdout()).toBe("");
});

test("two warnings with different hints both print", () => {
  setWarningLog(log);
  warn("repo-index", "a", { show: { title: "A repo folder in your settings does not exist", hint: "~/one was skipped" } });
  warn("repo-index", "b", { show: { title: "A repo folder in your settings does not exist", hint: "~/two was skipped" } });
  expect(io.errLines()).toEqual(["[warning] A repo folder in your settings does not exist  ~/one was skipped", "[warning] A repo folder in your settings does not exist  ~/two was skipped"]);
});

test("a quiet log records the warning and never shows it", () => {
  setWarningLog(log, { quiet: true });
  warn("repo-index", "rt.repoRoots could not be resolved (boom)", { show: shown });
  expect(logged).toHaveLength(1);
  expect(io.stderr()).toBe("");
});

test("the log never sees a credential in the message or the context", () => {
  setWarningLog(log);
  const url = "https://user:s3cret@example.invalid/x";
  warn("sync", `could not reach ${url}`, { context: { remote: url, tries: [url], attempt: 2 } });
  expect(logged).toEqual([
    {
      module: "sync",
      message: "could not reach https://[redacted]@example.invalid/x",
      context: { remote: "https://[redacted]@example.invalid/x", tries: ["https://[redacted]@example.invalid/x"], attempt: 2 },
    },
  ]);
});

test("with no log set, the stderr line carries no credential either", () => {
  warn("sync", "could not reach https://user:s3cret@example.invalid/x");
  expect(io.stderr()).toBe("rt: could not reach https://[redacted]@example.invalid/x\n");
});

test("a log that throws never breaks the caller", () => {
  setWarningLog(() => {
    throw new Error("disk full");
  });
  expect(() => warn("state", "x")).not.toThrow();
});
