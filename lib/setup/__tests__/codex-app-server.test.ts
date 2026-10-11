import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { codexAppServerStep, createCodexAppServerStep, createCodexInstall } from "../../agent-integrations/codex/install.ts";
import { createSessionStore } from "../../agent-integrations/session-store.ts";
import { openStateDb } from "../../state/index.ts";
import type { ApplyContext } from "../apply.ts";
import type { IntegrationSelection } from "../integration-selection.ts";
import type { ExecResult } from "../probes.ts";
import { attachedCodexSessions, codexAppServerRow } from "../validators/codex.ts";
import { toolRows } from "../validators/tools.ts";
import { fakeProbes, missing, ok } from "./fakes.ts";

const VERSION = "codex app-server daemon version";
const BOOTSTRAP = "codex app-server daemon bootstrap";
const RUNNING = ok(JSON.stringify({ status: "running", backend: "pid", socketPath: "/Users/member/.codex/app-server-control/app-server-control.sock" }));
const STOPPED = ok(JSON.stringify({ status: "stopped" }));
const UNPACKAGED: ExecResult = { code: 1, stdout: "", stderr: "Error: this CLI has no complete local package; install a packaged Codex CLI or use the standalone installer\n" };
const UNPACKAGED_COPY = "This Codex cannot run its app server. Uninstall it, then reinstall it with setup's Install, which uses OpenAI's installer";

const LOGIN = "codex login status";
const RESTART = "codex app-server daemon restart";
const SIGNED_IN = ok("Logged in using ChatGPT\n");
const SIGNED_OUT: ExecResult = { code: 1, stdout: "Not logged in\n", stderr: "" };
const PID_FILE = "/Users/member/.codex/app-server-daemon/daemon.pid";
const AUTH_FILE = "/Users/member/.codex/auth.json";
/** The live shape (S9b): the server's start, in Unix seconds, sits under processIdentity. */
const pidFile = (startSeconds: unknown) =>
  JSON.stringify({ pid: 4646, processStartTime: "Sun Oct 11 02:21:42 2026", processIdentity: { bootId: "b", uniqueId: 4646, startSeconds } });
const STARTED_AT = 1_791_685_302;

type MacOpts = { signIn?: ExecResult; pid?: string; authMtimeMs?: number; restart?: ExecResult };

/** `versions` answers each `version` probe in turn; the last answer repeats. Signed in, with no sign-in or server times, unless `opts` says otherwise. */
function codexMac(versions: ExecResult[], bootstrap: ExecResult = ok(JSON.stringify({ status: "bootstrapped", backend: "pid" })), opts: MacOpts = {}) {
  let probe = 0;
  return fakeProbes({
    home: "/Users/member",
    files: opts.pid === undefined ? {} : { [PID_FILE]: opts.pid },
    mtimes: opts.authMtimeMs === undefined ? {} : { [AUTH_FILE]: opts.authMtimeMs },
    exec: (argv) => {
      const cmd = argv.join(" ");
      if (cmd === VERSION) return versions[Math.min(probe++, versions.length - 1)]!;
      if (cmd === LOGIN) return opts.signIn ?? SIGNED_IN;
      if (cmd === BOOTSTRAP) return bootstrap;
      if (cmd === RESTART) return opts.restart ?? ok(JSON.stringify({ status: "restarted" }));
      return missing(argv[0] ?? "");
    },
  });
}

const NO_SESSIONS = async () => 0;
const UNREADABLE_SESSIONS = async () => null;

/** Signed in a minute after the running server started: `codex login` while the server was up. */
const signedInAfterStart = (versions: ExecResult[], opts: MacOpts = {}) =>
  codexMac(versions, undefined, { pid: pidFile(STARTED_AT), authMtimeMs: (STARTED_AT + 60) * 1000, ...opts });

function ctxFor(p: ReturnType<typeof fakeProbes>, extra: Partial<ApplyContext> = {}) {
  const logs: string[] = [];
  const ctx = { p, log: (_id: string, line: string) => logs.push(line), integrations: { switchOn: true, enabled: ["codex"] }, ...extra } as unknown as ApplyContext;
  return { ctx, logs };
}

const ran = (p: ReturnType<typeof fakeProbes>) => p.calls.exec.map((a) => a.join(" "));

describe("the Codex app server row", () => {
  test("running reads ready", async () => {
    expect(await codexAppServerRow(codexMac([RUNNING]))).toMatchObject({ id: "tool.codex-app-server", status: "ready", required: false, detail: "Running", action: null });
  });

  test("not running offers the step that starts it", async () => {
    for (const answer of [STOPPED, { code: 1, stdout: "", stderr: "not running" }]) {
      const row = await codexAppServerRow(codexMac([answer]));
      expect(row).toMatchObject({ status: "missing", detail: "Not running", optionalNote: "Started by Install (codex.app-server)." });
      expect(row.action).toEqual({ type: "run", label: "Start", verb: ["setup", "apply", "--only", "codex.app-server"] });
    }
  });

  test("a Codex that cannot run an app server asks for a reinstall, with no action rt cannot perform", async () => {
    const row = await codexAppServerRow(codexMac([UNPACKAGED]));
    expect(row).toMatchObject({ status: "needs-you", detail: UNPACKAGED_COPY, action: null });
  });

  test("no Codex: skipped, since the Codex row already asks for it", async () => {
    expect(await codexAppServerRow(codexMac([missing("codex")]))).toMatchObject({ status: "skipped", detail: "Codex is not installed yet", action: null });
  });

  test("a probe that times out is an error, never a start", async () => {
    expect(await codexAppServerRow(codexMac([{ code: 124, stdout: "", stderr: "" }]))).toMatchObject({ status: "error", action: null });
  });

  test("the plan lists it between the MCP entry and the hooks, only with Codex on", async () => {
    const secrets = { has: async () => null };
    const codexPolicy = async () => ({ ok: false as const, error: { code: "not-ready" as const, message: "x" } });
    const idsFor = async (integrations: IntegrationSelection) => {
      const p = codexMac([RUNNING]);
      const ids = (await toolRows(p, [], { hasBrew: false, secrets, integrations, codexPolicy })).map((r) => r.id);
      return { ids, probed: ran(p).includes(VERSION) };
    };
    const on = await idsFor({ switchOn: true, enabled: ["codex"] });
    expect(on.ids.indexOf("tool.codex-app-server")).toBe(on.ids.indexOf("tool.codex-mcp") + 1);
    expect(on.ids.indexOf("tool.codex-policy")).toBe(on.ids.indexOf("tool.codex-app-server") + 1);
    for (const integrations of [{ switchOn: false }, { switchOn: true, enabled: ["claude"] }] as IntegrationSelection[]) {
      const off = await idsFor(integrations);
      expect(off.ids).not.toContain("tool.codex-app-server");
      expect(off.probed).toBe(false);
    }
  });

  test("signed out: asks for the sign-in first, never offering a start", async () => {
    for (const versions of [[STOPPED], [RUNNING]]) {
      const row = await codexAppServerRow(codexMac(versions, undefined, { signIn: SIGNED_OUT }));
      expect(row).toMatchObject({ status: "needs-you", detail: "Sign in to Codex first. Its app server can only use your account once you have" });
      expect(row.action).toEqual({ type: "steps", label: "Show steps…", steps: ["Open a terminal", "Run: codex login", "Follow the sign-in prompt"] });
    }
  });

  test("a sign-in that cannot be checked starts nothing either", async () => {
    for (const signIn of [{ code: 2, stdout: "", stderr: "error: unrecognized subcommand" }, { code: 124, stdout: "", stderr: "" }]) {
      const row = await codexAppServerRow(codexMac([STOPPED], undefined, { signIn }));
      expect(row).toMatchObject({ status: "needs-you", detail: "rt could not check your Codex sign-in. Confirm you are signed in" });
      expect(row.action?.type).toBe("steps");
    }
  });

  test("running since before the sign-in, with no Codex session on it, offers a restart", async () => {
    const row = await codexAppServerRow(signedInAfterStart([RUNNING]), NO_SESSIONS);
    expect(row).toMatchObject({ status: "needs-you", detail: "Running, but it started before you signed in, so it cannot use your account" });
    expect(row.action).toEqual({ type: "run", label: "Restart", verb: ["setup", "apply", "--only", "codex.app-server"] });
  });

  test("running since before the sign-in with Codex sessions attached asks to restart once they are done", async () => {
    const row = await codexAppServerRow(signedInAfterStart([RUNNING]), async () => 2);
    expect(row).toMatchObject({ status: "needs-you", detail: "Codex's app server started before you signed in. Restart it once your Codex sessions are done" });
    expect(row.action).toEqual({ type: "run", label: "Restart", verb: ["setup", "apply", "--only", "codex.app-server"] });
  });

  test("running since after the sign-in, or with times or sessions rt cannot read, reads ready", async () => {
    for (const p of [
      codexMac([RUNNING], undefined, { pid: pidFile(STARTED_AT), authMtimeMs: (STARTED_AT - 60) * 1000 }),
      signedInAfterStart([RUNNING], { pid: "not json" }),
      codexMac([RUNNING], undefined, { authMtimeMs: (STARTED_AT + 60) * 1000 }),
    ]) {
      expect(await codexAppServerRow(p, NO_SESSIONS)).toMatchObject({ status: "ready", detail: "Running" });
    }
    expect(await codexAppServerRow(signedInAfterStart([RUNNING]), UNREADABLE_SESSIONS)).toMatchObject({ status: "ready", detail: "Running" });
  });

  test("the sessions are read only when the server predates the sign-in", async () => {
    let asked = 0;
    const count = async () => { asked++; return 0; };
    await codexAppServerRow(codexMac([RUNNING], undefined, { pid: pidFile(STARTED_AT), authMtimeMs: (STARTED_AT - 60) * 1000 }), count);
    await createCodexAppServerStep({ sleep: async () => {}, codexSessions: count }).run(ctxFor(codexMac([STOPPED, RUNNING])).ctx);
    expect(asked).toBe(0);
  });

  test("the row only reads: it never bootstraps", async () => {
    const p = codexMac([STOPPED]);
    await codexAppServerRow(p);
    expect(ran(p)).toEqual([VERSION, LOGIN]);
  });
});

describe("the attached Codex sessions a restart would interrupt", () => {
  test("counts only Codex bindings still attached", async () => {
    const db = openStateDb(join(mkdtempSync(join(tmpdir(), "codex-app-server-")), "state.db"));
    const store = createSessionStore(db);
    const ref = (harness: string, value: string) => ({ harness, profile: "default", kind: "id" as const, value });
    expect(await attachedCodexSessions(() => db)).toBe(0);
    const live = store.bind(store.reserve({ identity: "a" }), ref("codex", "T1"), { mode: "headless" });
    store.bind(store.reserve({ identity: "b" }), ref("claude", "S1"), { mode: "headless" });
    const gone = store.bind(store.reserve({ identity: "c" }), ref("codex", "T2"), { mode: "headless" });
    if (!live.ok || !gone.ok) throw new Error("bind failed");
    store.detach(gone.data.key, gone.data.attachment.generation);
    expect(await attachedCodexSessions(() => db)).toBe(1);
  });

  test("a state database that cannot be opened reads as unknown", async () => {
    expect(await attachedCodexSessions(() => { throw new Error("database is locked"); })).toBeNull();
  });
});

describe("codex.app-server", () => {
  let waits: number[] = [];
  const step = createCodexAppServerStep({ sleep: async (ms) => void waits.push(ms), codexSessions: NO_SESSIONS });
  beforeEach(() => {
    waits = [];
  });

  test("a server still coming up right after the bootstrap is read again until it runs", async () => {
    const p = codexMac([STOPPED, STOPPED, STOPPED, RUNNING]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "done", detail: "Started Codex's app server" });
    expect(ran(p)).toEqual([VERSION, LOGIN, BOOTSTRAP, VERSION, VERSION, VERSION]);
    expect(waits).toHaveLength(2);
  });

  test("the wait after the bootstrap is bounded to a few reads over about three seconds", async () => {
    const p = codexMac([STOPPED]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex said it started its app server, but it is not running" });
    expect(ran(p).filter((c) => c === VERSION)).toHaveLength(5);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3000);
  });

  test("no wait when the server runs at the first read after the bootstrap", async () => {
    await step.run(ctxFor(codexMac([STOPPED, RUNNING])).ctx);
    expect(waits).toEqual([]);
  });

  test("is an rt step, update-safe, and applies only with Codex turned on", () => {
    expect(codexAppServerStep).toMatchObject({ id: "codex.app-server", kind: "rt", updateSafe: true });
    expect(codexAppServerStep.applies(ctxFor(codexMac([RUNNING])).ctx)).toBe(true);
    expect(codexAppServerStep.applies(ctxFor(codexMac([RUNNING]), { integrations: { switchOn: true, enabled: ["claude"] } }).ctx)).toBe(false);
    expect(codexAppServerStep.applies(ctxFor(codexMac([RUNNING]), { integrations: { switchOn: false } }).ctx)).toBe(false);
  });

  test("Codex's adapter runs it after the MCP entry and before the policy hooks", () => {
    expect(createCodexInstall().steps().map((s) => s.id)).toEqual(["codex.mcp", "codex.app-server", "codex.policy"]);
  });

  test("already running: nothing is started", async () => {
    const p = codexMac([RUNNING]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "skipped", detail: "Already running" });
    expect(ran(p)).toEqual([VERSION, LOGIN]);
  });

  test("not running: bootstraps it, then reads it running", async () => {
    const p = codexMac([STOPPED, RUNNING]);
    const { ctx, logs } = ctxFor(p);
    expect(await step.run(ctx)).toEqual({ state: "done", detail: "Started Codex's app server" });
    expect(ran(p)).toEqual([VERSION, LOGIN, BOOTSTRAP, VERSION]);
    expect(logs).toEqual(["started Codex's app server"]);
  });

  test("an update run brings a stopped server back, the way a reboot leaves it", async () => {
    const p = codexMac([STOPPED, RUNNING]);
    expect(await step.run(ctxFor(p, { update: true }).ctx)).toEqual({ state: "done", detail: "Started Codex's app server" });
    expect(ran(p)).toEqual([VERSION, LOGIN, BOOTSTRAP, VERSION]);
  });

  test("a bootstrap that holds its output open past the deadline still counts once the server reads running", async () => {
    const p = codexMac([STOPPED, RUNNING], { code: 124, stdout: "", stderr: "" });
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "done", detail: "Started Codex's app server" });
  });

  test("a bootstrap that fails is a plain needs-you that does not stop Install", async () => {
    const p = codexMac([STOPPED], { code: 1, stdout: "", stderr: "Error: address in use\nmore" });
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex could not start its app server (exit 1): Error: address in use" });
  });

  test("a bootstrap that times out with nothing running says so", async () => {
    const p = codexMac([STOPPED], { code: 124, stdout: "", stderr: "" });
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex's app server did not start in time. Start it again from setup's checklist" });
  });

  test("a bootstrap that reports success but leaves nothing running is not claimed started", async () => {
    const p = codexMac([STOPPED]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex said it started its app server, but it is not running" });
  });

  test("a Codex without its packaged install asks for a reinstall, whether the probe or the bootstrap says so", async () => {
    const atProbe = codexMac([UNPACKAGED]);
    expect(await step.run(ctxFor(atProbe).ctx)).toEqual({ state: "needs-you", detail: UNPACKAGED_COPY });
    expect(ran(atProbe)).toEqual([VERSION]);

    const atBootstrap = codexMac([STOPPED], UNPACKAGED);
    expect(await step.run(ctxFor(atBootstrap).ctx)).toEqual({ state: "needs-you", detail: UNPACKAGED_COPY });
    expect(ran(atBootstrap)).toEqual([VERSION, LOGIN, BOOTSTRAP]);
  });

  test("no Codex: skipped, and nothing is started", async () => {
    const p = codexMac([missing("codex")]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "skipped", detail: "Codex is not installed yet" });
    expect(ran(p)).toEqual([VERSION]);
  });

  test("a probe that times out starts nothing", async () => {
    const p = codexMac([{ code: 124, stdout: "", stderr: "" }]);
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail: "Codex did not say in time whether its app server is running. Check again in a moment" });
    expect(ran(p)).toEqual([VERSION]);
  });

  test("signed out: starts nothing and asks for the sign-in first", async () => {
    for (const versions of [[STOPPED], [RUNNING]]) {
      const p = codexMac(versions, undefined, { signIn: SIGNED_OUT });
      expect(await step.run(ctxFor(p).ctx)).toEqual({
        state: "needs-you", detail: "Codex is not signed in, so rt did not start its app server. Sign in to Codex first",
      });
      expect(ran(p)).toEqual([VERSION, LOGIN]);
    }
  });

  test("a sign-in that cannot be checked starts nothing", async () => {
    for (const signIn of [{ code: 2, stdout: "", stderr: "error: unrecognized subcommand" }, { code: 124, stdout: "", stderr: "" }]) {
      const p = codexMac([STOPPED], undefined, { signIn });
      expect(await step.run(ctxFor(p).ctx)).toEqual({
        state: "needs-you", detail: "rt could not check your Codex sign-in, so it did not start Codex's app server. Confirm you are signed in",
      });
      expect(ran(p)).toEqual([VERSION, LOGIN]);
    }
  });

  test("a server that started before the sign-in is restarted once, then read running", async () => {
    const p = signedInAfterStart([RUNNING]);
    const { ctx, logs } = ctxFor(p, { update: true });
    expect(await step.run(ctx)).toEqual({ state: "done", detail: "Restarted Codex's app server so it uses your sign-in" });
    expect(ran(p)).toEqual([VERSION, LOGIN, RESTART, VERSION]);
    expect(logs).toEqual(["restarted Codex's app server, which started before the sign-in"]);
  });

  test("a server that predates the sign-in but hosts attached Codex sessions is left running", async () => {
    const p = signedInAfterStart([RUNNING]);
    const busy = createCodexAppServerStep({ sleep: async () => {}, codexSessions: async () => 1 });
    expect(await busy.run(ctxFor(p, { update: true }).ctx)).toEqual({
      state: "needs-you",
      detail: "Codex's app server started before you signed in, and your Codex sessions are using it, so rt left it running. Restart it once they are done",
    });
    expect(ran(p)).not.toContain(RESTART);
  });

  test("a server that predates the sign-in is left running when rt cannot read its Codex sessions", async () => {
    const p = signedInAfterStart([RUNNING]);
    const blind = createCodexAppServerStep({ sleep: async () => {}, codexSessions: UNREADABLE_SESSIONS });
    expect(await blind.run(ctxFor(p).ctx)).toEqual({ state: "skipped", detail: "Already running" });
    expect(ran(p)).not.toContain(RESTART);
  });

  test("a sign-in in the same second the server started still counts as newer", async () => {
    const p = codexMac([RUNNING], undefined, { pid: pidFile(STARTED_AT), authMtimeMs: STARTED_AT * 1000 + 400 });
    await step.run(ctxFor(p).ctx);
    expect(ran(p)).toContain(RESTART);
  });

  test("a restart that fails, times out or leaves nothing running is a plain needs-you", async () => {
    const cases: Array<[ExecResult, ExecResult[], string]> = [
      [{ code: 1, stdout: "", stderr: "Error: busy\nmore" }, [RUNNING, STOPPED], "Codex could not restart its app server (exit 1): Error: busy"],
      [{ code: 124, stdout: "", stderr: "" }, [RUNNING, STOPPED], "Codex's app server did not restart in time. Restart it again from setup's checklist"],
      [ok(JSON.stringify({ status: "restarted" })), [RUNNING, STOPPED], "Codex said it restarted its app server, but it is not running"],
    ];
    for (const [restart, versions, detail] of cases) {
      const p = signedInAfterStart(versions, { restart });
      expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "needs-you", detail });
      expect(ran(p).filter((c) => c === RESTART)).toHaveLength(1);
    }
  });

  test("a server newer than the sign-in is left running", async () => {
    const p = codexMac([RUNNING], undefined, { pid: pidFile(STARTED_AT), authMtimeMs: (STARTED_AT - 60) * 1000 });
    expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "skipped", detail: "Already running" });
    expect(ran(p)).toEqual([VERSION, LOGIN]);
  });

  test("never restarts on a guess: no pid file, an unreadable one, no start time, or no sign-in file", async () => {
    for (const p of [
      codexMac([RUNNING], undefined, { authMtimeMs: (STARTED_AT + 60) * 1000 }),
      signedInAfterStart([RUNNING], { pid: "{not json" }),
      signedInAfterStart([RUNNING], { pid: JSON.stringify({ pid: 4646 }) }),
      signedInAfterStart([RUNNING], { pid: pidFile("1791685302") }),
      codexMac([RUNNING], undefined, { pid: pidFile(STARTED_AT) }),
    ]) {
      expect(await step.run(ctxFor(p).ctx)).toEqual({ state: "skipped", detail: "Already running" });
      expect(ran(p)).not.toContain(RESTART);
    }
  });

  test("reads only when auth.json was written, never what is in it", async () => {
    const p = signedInAfterStart([RUNNING]);
    const touched: string[] = [];
    const watch = <K extends "readFile" | "readPrefix" | "fileSize" | "fileMode" | "fileMtimeMs" | "exists" | "statPath" | "readlink">(name: K) =>
      ((path: string) => {
        if (path === AUTH_FILE) touched.push(name);
        return (p[name] as (path: string) => unknown)(path);
      }) as (typeof p)[K];
    const watched = {
      ...p,
      readFile: watch("readFile"), readPrefix: watch("readPrefix"), fileSize: watch("fileSize"), fileMode: watch("fileMode"),
      fileMtimeMs: watch("fileMtimeMs"), exists: watch("exists"), statPath: watch("statPath"), readlink: watch("readlink"),
    };
    await step.run(ctxFor(watched as typeof p).ctx);
    await codexAppServerRow(watched as typeof p, NO_SESSIONS);
    expect(touched.length).toBeGreaterThan(0);
    expect(new Set(touched)).toEqual(new Set(["fileMtimeMs"]));
  });

  test("never asks for remote control, an update or a stop", async () => {
    const p = codexMac([STOPPED, RUNNING]);
    await step.run(ctxFor(p).ctx);
    for (const argv of [...p.calls.exec, ...signedInAfterStart([RUNNING]).calls.exec]) {
      expect(argv).not.toContain("--remote-control");
      expect(argv).not.toContain("update");
      expect(argv).not.toContain("stop");
    }
  });
});
