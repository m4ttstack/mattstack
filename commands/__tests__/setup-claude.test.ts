import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupClaudeCode, setupClaudeConnect, type ClaudeDeps } from "../setup-claude.ts";
import { loginSessionPath, type LoginSeams, type LoginSession } from "../../lib/setup/cli-login.ts";
import { fakeProbes, ok, type ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import { readStdinJson } from "../../lib/setup/probes.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

const HOME = "/fake-home";
const NOW = new Date("2026-01-01T00:00:00Z");
const LOGINS = `${HOME}/.mattstack/rt/logins`;
const RECORD = loginSessionPath(HOME, "claude");

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

function fakeSeams(): LoginSeams & { spawned: string[][]; killed: number[]; written: Array<[string, string]> } {
  const spawned: string[][] = [];
  const killed: number[] = [];
  const written: Array<[string, string]> = [];
  return {
    spawned,
    killed,
    written,
    spawnDetached(argv) {
      spawned.push(argv);
      return 4242;
    },
    alive: () => true,
    kill(pid) {
      killed.push(pid);
    },
    mkfifo: () => true,
    writeFifo(path, text) {
      written.push([path, text]);
      return true;
    },
  };
}

/** `claude auth status --json` answers signed out until its `signedInAfter`-th call, then signed in. */
function claudeStatus(opts: { signedInAfter?: number; email?: string; gitEmail?: string } = {}): ExecScript & { statusCalls: () => number } {
  let calls = 0;
  const script = ((argv: string[]) => {
    if (argv[0] === "claude" && argv[1] === "auth" && argv[2] === "status") {
      calls++;
      const loggedIn = opts.signedInAfter !== undefined && calls > opts.signedInAfter;
      return ok(JSON.stringify(loggedIn ? { loggedIn: true, authMethod: "claude.ai", ...(opts.email ? { email: opts.email } : {}) } : { loggedIn: false }));
    }
    if (argv[0] === "git" && argv.includes("user.email")) return opts.gitEmail ? ok(`${opts.gitEmail}\n`) : { code: 1, stdout: "", stderr: "" };
    return ok();
  }) as ExecScript & { statusCalls: () => number };
  script.statusCalls = () => calls;
  return script;
}

function session(): LoginSession {
  return { tool: "claude", pid: 4242, startedAt: NOW.toISOString(), logPath: `${LOGINS}/claude.log`, fifoPath: `${LOGINS}/claude.fifo`, url: null, code: null, prompt: true };
}

function harness(opts: { exec: ExecScript; files?: Record<string, string>; stdin?: unknown }) {
  const lines: unknown[] = [];
  const sleeps: number[] = [];
  const seams = fakeSeams();
  const probes = fakeProbes({ home: HOME, now: NOW, exec: opts.exec, files: opts.files });
  const d: ClaudeDeps = {
    probes,
    json: (v) => lines.push(v),
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    seams,
    stdin: async () => opts.stdin ?? null,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  return { d, lines, sleeps, seams, probes };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ExitSentinel) return err.code;
    throw err;
  }
}

let quiet: CapturedOut;
beforeEach(() => {
  quiet = capturePlain();
});
afterEach(() => quiet.restore());

describe("rt setup claude connect", () => {
  test("already signed in answers ready without a login", async () => {
    const t = harness({ exec: claudeStatus({ signedInAfter: 0, email: "janedoe@example.com" }) });
    expect(await exitCode(() => setupClaudeConnect(["--json"], {}, t.d))).toBeUndefined();
    expect(t.lines).toEqual([{ contract: 1, at: NOW.toISOString(), integration: "claude", status: "ready", detail: "Signed in as janedoe@example.com" }]);
    expect(t.seams.spawned).toEqual([]);
  });

  test("a status with no email reads Signed in", async () => {
    const t = harness({ exec: claudeStatus({ signedInAfter: 0 }) });
    await setupClaudeConnect(["--json"], {}, t.d);
    expect(t.lines[0]).toMatchObject({ status: "ready", detail: "Signed in" });
  });

  test("a login that lands within the wait answers ready and ends the session", async () => {
    const t = harness({ exec: claudeStatus({ signedInAfter: 3, email: "janedoe@example.com" }) });
    await setupClaudeConnect(["--json"], {}, t.d);
    expect(t.seams.spawned).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ integration: "claude", status: "ready", detail: "Signed in as janedoe@example.com" });
    expect(t.sleeps).toEqual([2000, 2000, 2000]);
    expect(t.seams.killed).toEqual([4242]);
    expect(t.probes.readFile(RECORD)).toBeNull();
  });

  test("a login still open answers needs-you, keeping the session", async () => {
    const exec = claudeStatus();
    const t = harness({ exec });
    await setupClaudeConnect(["--json"], {}, t.d);
    expect(t.lines[0]).toMatchObject({ integration: "claude", status: "needs-you", detail: "Finish signing in in your browser" });
    expect(t.sleeps).toEqual([2000, 2000, 2000, 2000, 2000]);
    expect(exec.statusCalls()).toBe(6);
    expect(t.seams.killed).toEqual([]);
    expect(t.probes.readFile(RECORD)).not.toBeNull();
  });

  test("the git email is passed to claude", async () => {
    const t = harness({ exec: claudeStatus({ gitEmail: "janedoe@example.com" }) });
    await setupClaudeConnect(["--json"], {}, t.d);
    expect(t.seams.spawned[0]!.slice(5)).toEqual(["claude", "auth", "login", "--email", "janedoe@example.com"]);
  });

  test("no git email starts the login without one", async () => {
    const t = harness({ exec: claudeStatus() });
    await setupClaudeConnect(["--json"], {}, t.d);
    expect(t.seams.spawned[0]!.slice(5)).toEqual(["claude", "auth", "login"]);
  });

  test("a login that does not start exits 2 with login-failed", async () => {
    const t = harness({ exec: claudeStatus() });
    t.d.seams = { ...t.seams, spawnDetached: () => null };
    expect(await exitCode(() => setupClaudeConnect(["--json"], {}, t.d))).toBe(2);
    expect(t.lines[0]).toMatchObject({ error: { code: "login-failed" } });
  });
});

describe("rt setup claude code", () => {
  const seeded = () => ({ [RECORD]: JSON.stringify(session()), [`${LOGINS}/claude.log`]: "Paste code here if prompted >" });

  test("a code reaches the session and a signed-in status answers ready", async () => {
    const t = harness({ exec: claudeStatus({ signedInAfter: 1, email: "janedoe@example.com" }), files: seeded(), stdin: { code: "abc-123" } });
    expect(await exitCode(() => setupClaudeCode(["--json"], {}, t.d))).toBeUndefined();
    expect(t.seams.written).toEqual([[`${LOGINS}/claude.fifo`, "abc-123\n"]]);
    expect(t.lines[0]).toMatchObject({ integration: "claude", status: "ready", detail: "Signed in as janedoe@example.com" });
    expect(t.seams.killed).toEqual([4242]);
    expect(t.probes.readFile(RECORD)).toBeNull();
  });

  test("a code with no session is refused", async () => {
    const t = harness({ exec: claudeStatus(), stdin: { code: "abc-123" } });
    expect(await exitCode(() => setupClaudeCode(["--json"], {}, t.d))).toBe(2);
    expect(t.lines[0]).toMatchObject({ error: { code: "no-login", message: "Start signing in again" } });
    expect(t.seams.written).toEqual([]);
  });

  test("a code claude rejects answers invalid", async () => {
    const exec = claudeStatus();
    const t = harness({ exec, files: seeded(), stdin: { code: "abc-123" } });
    await setupClaudeCode(["--json"], {}, t.d);
    expect(t.lines[0]).toMatchObject({ integration: "claude", status: "invalid", detail: "Claude did not accept that code" });
    expect(t.sleeps.reduce((a, b) => a + b, 0)).toBe(30_000);
    expect(exec.statusCalls()).toBe(15);
    expect(t.seams.killed).toEqual([]);
    expect(t.probes.readFile(RECORD)).not.toBeNull();
  });

  test("a garbled body is refused, not a crash", async () => {
    const t = harness({ exec: claudeStatus(), files: seeded() });
    t.d.stdin = () => readStdinJson(new Response("{not json").body!);
    expect(await exitCode(() => setupClaudeCode(["--json"], {}, t.d))).toBe(2);
    expect(t.lines[0]).toMatchObject({ error: { code: "bad-stdin" } });
    expect(t.seams.written).toEqual([]);
  });

  test("no code on stdin is refused before anything reaches the session", async () => {
    const t = harness({ exec: claudeStatus(), files: seeded(), stdin: null });
    expect(await exitCode(() => setupClaudeCode(["--json"], {}, t.d))).toBe(2);
    expect(t.lines[0]).toMatchObject({ error: { code: "bad-stdin" } });
    expect(t.seams.written).toEqual([]);
  });
});
