/**
 * rt herd, rt pane and rt agent are read by agents and skills, so their
 * bytes off a terminal are frozen. Captured once from the unconverted code
 * against a fake daemon; never regenerated.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { DAEMON_SOCK_PATH } from "../../lib/daemon-config.ts";
import { isDaemonRunning } from "../../lib/daemon-client.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { paneAccounts, paneDirectories, paneFocus, paneList, panePeek, paneSend, paneSpawn } from "../pane.ts";
import { agent } from "../agent.ts";
import {
  answer as herdAnswer, ask as herdAsk, attend as herdAttend, close as herdClose, followUp as herdFollowUp, gates as herdGates,
  list as herdList, milestone as herdMilestone, report as herdReport, resume as herdResume, spawn as herdSpawn, start as herdStart,
  status as herdStatus, stop as herdStop, wrapUp as herdWrapUp,
} from "../herd.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "herd-pane-agent-bytes.json");

let home: string;
let repo: string;
let origHome: string | undefined;
const ENV_KEYS = ["HERD_ID", "HERD_JOB", "CLAUDE_CODE_SESSION_ID", "HERDR_WORKSPACE_ID", "HERDR_PANE_ID", "CLAUDE_CONFIG_DIR", "HERDR_SOCKET_PATH", "HERDR_BIN"] as const;
const origEnv: Record<string, string | undefined> = {};
let server: ReturnType<typeof Bun.serve>;
let probeServer: ReturnType<typeof Bun.serve>;
let replies: Record<string, unknown> = {};

beforeAll(() => {
  origHome = process.env.HOME;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-hpa-bytes-")));
  process.env.HOME = home;
  for (const k of ENV_KEYS) {
    origEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.HERDR_SOCKET_PATH = join(home, "absent-herdr.sock");
  process.env.HERDR_BIN = "/usr/bin/false";
  mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
  probeServer = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => Response.json({ ok: true, data: {} }) });
  repo = join(home, "sample-app");
  mkdirSync(repo);
  spawnSync("git", ["init", "-q", repo]);
  const sockDir = join(home, ".mattstack", "rt");
  mkdirSync(sockDir, { recursive: true });
  server = Bun.serve({
    unix: join(sockDir, "rt.sock"),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      if (cmd === "ping") return Response.json({ ok: true, data: {} });
      return Response.json(replies[cmd] ?? { ok: false, error: `unknown command: ${cmd}` });
    },
  });
});

afterAll(() => {
  server.stop(true);
  probeServer.stop(true);
  process.env.HOME = origHome;
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  rmSync(home, { recursive: true, force: true });
});

class Exit extends Error {
  constructor(public code: number) {
    super("process.exit sentinel");
  }
}

async function runVerb(fn: (args: string[]) => Promise<void>, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Exit(code ?? 0);
  }) as unknown as typeof process.exit);
  let code = 0;
  try {
    await fn(args);
  } catch (err) {
    if (err instanceof Exit) code = err.code;
    else throw err;
  } finally {
    exit.mockRestore();
    io.restore();
  }
  const r = { code, stdout: io.stdout(), stderr: io.stderr() };
  return r;
}

const PANE = { paneId: "w1:p1", workspace: "acme", title: "Evaluate codegen", repo: "sample-app", branch: "main", agentStatus: "idle", presence: { handle: "meg.1", name: "meg", status: "live", rooms: ["build"] } };
const BG = { ...PANE, paneId: "bg:w9:p1", title: "nightly", presence: undefined };
const RECORD = { id: "ag-1a2b3c4d", repo: "sample-app", cwd: "/code/sample-app", provider: "claude", surface: "herdr", sessionId: "11111111-2222-3333-4444-555555555555", model: "opus", paneId: "w1:p2", createdAt: 1_700_000_000_000 };
const HERD = { id: "h-sample", repo: "sample-app", room: "herd-h-sample", workspace: "w1", shepherdSession: "s", shepherdHandle: "ana.1", shepherdName: "ana", herdrSocket: null, hidden: false, status: "active", createdAt: 1, wrappedAt: null };
const JOB = { herd: "h-sample", name: "job-a", worktree: "/code/wt", branch: "job-a", tree: "wt", pane: "w1:p3", agentSession: "s2", agentId: null, handle: "job-a.2", handleName: "job-a", status: "active", disposable: false, lastGate: null, lastReport: null, createdAt: 1, updatedAt: 1, openGate: null, paneStatus: "working", sessionDead: false, lastGateStatus: null, lastGateDelivery: null, lastGateConsumed: null };
const STATUS = { herd: HERD, jobs: [JOB, { ...JOB, name: "job-b", pane: "w1:p4", status: "stuck-at-modal", paneStatus: "blocked" }, { ...JOB, name: "job-c", pane: "w1:p5", sessionDead: true }, { ...JOB, name: "job-d", pane: "w1:p6", status: "at-gate", lastGate: "g7", lastGateStatus: "answered", lastGateDelivery: "dead-pane", lastGateConsumed: false }], unread: 3, lifecycleConnected: false, hiddenUp: null, subscription: null, push: { state: "unreachable", lastDelivery: null } };
const GATE = { id: "g7", subject: "herd:h-sample/job-d", kind: "decision", questions: [{ id: "q", label: "Ship it?", multi: false, options: ["yes", "no"] }] };

describe("herd, pane and agent (frozen bytes)", () => {
  test("every verb writes the bytes it wrote before the output layer", async () => {
    expect(await isDaemonRunning()).toBe(true);
    const got: Record<string, { code: number; stdout: string; stderr: string }> = {};
    const stable = (s: string) => s.replaceAll(home, "<home>").replace(/\b\d+[mhd] ago\b/g, "<age> ago");
    const run = async (name: string, fn: (args: string[]) => Promise<void>, args: string[]) => {
      const r = await runVerb(fn, args);
      got[name] = { code: r.code, stdout: stable(r.stdout), stderr: stable(r.stderr) };
    };

    replies = { "pane:list": { ok: true, data: { panes: [PANE, BG] } } };
    await run("pane-list", paneList, []);
    await run("pane-list-json", paneList, ["--json"]);
    replies = { "pane:list": { ok: true, data: { panes: [] } } };
    await run("pane-list-none", paneList, []);
    replies = { "pane:list": { ok: false, error: "herdr unavailable: no socket" } };
    await run("pane-list-refused", paneList, []);
    await run("pane-list-refused-json", paneList, ["--json"]);
    replies = { "pane:peek": { ok: true, data: { paneId: "w1:p1", lines: ["$ ls", "a  b"] } } };
    await run("pane-peek", panePeek, ["w1:p1", "--lines", "2"]);
    await run("pane-peek-json", panePeek, ["w1:p1", "--lines", "2", "--json"]);
    await run("pane-peek-bad-lines", panePeek, ["w1:p1", "--lines", "x"]);
    replies = { "pane:spawn": { ok: true, data: { ready: true, pane: PANE } } };
    await run("pane-spawn", paneSpawn, ["--cwd", "/code/sample-app"]);
    await run("pane-spawn-json", paneSpawn, ["--cwd", "/code/sample-app", "--json"]);
    await run("pane-spawn-no-cwd", paneSpawn, []);
    replies = { "pane:send": { ok: true, data: { paneId: "w1:p1", delivered: "accepted", continuation: { delivered: "scheduled" } } } };
    await run("pane-send-then", paneSend, ["w1:p1", "--text", "hi", "--then", "next"]);
    await run("pane-send-then-json", paneSend, ["w1:p1", "--text", "hi", "--then", "next", "--json"]);
    replies = { "pane:send": { ok: true, data: { paneId: "w1:p1", delivered: "refused", reason: "at a prompt" } } };
    await run("pane-send-refused", paneSend, ["w1:p1", "--text", "hi"]);
    replies = { "pane:focus": { ok: true, data: { paneId: "w1:p1", focused: true } } };
    await run("pane-focus", paneFocus, ["w1:p1"]);
    await run("pane-focus-json", paneFocus, ["w1:p1", "--json"]);
    replies = { "pane:accounts": { ok: true, data: { accounts: [{ slot: 1, email: "a@example.com", alias: "work", headroom: "62%" }, { slot: 2, email: "b@example.com" }] } } };
    await run("pane-accounts", paneAccounts, []);
    await run("pane-accounts-json", paneAccounts, ["--json"]);
    replies = { "pane:accounts": { ok: true, data: { accounts: [] } } };
    await run("pane-accounts-none", paneAccounts, []);
    replies = { "pane:directories": { ok: true, data: { directories: [{ path: "/code/sample-app", repo: "sample-app", branch: "main" }] } } };
    await run("pane-directories", paneDirectories, []);
    await run("pane-directories-json", paneDirectories, ["--json"]);

    replies = { "agent:list": { ok: true, data: { agents: [RECORD, { ...RECORD, id: "ag-9", finishedAt: 2, exitCode: 0 }] } } };
    await run("agent-list", agent, ["list"]);
    await run("agent-list-json", agent, ["list", "--json"]);
    replies = { "agent:list": { ok: true, data: { agents: [] } } };
    await run("agent-list-none", agent, ["list"]);
    replies = { "agent:get": { ok: true, data: RECORD } };
    await run("agent-show", agent, ["show", "ag-1a2b3c4d"]);
    await run("agent-show-no-id", agent, ["show"]);
    replies = { "agent:start": { ok: true, data: { ...RECORD, provider: "codex" } } };
    await run("agent-start-codex", agent, ["start", "--repo", repo, "--provider", "codex", "--prompt", "hi"]);
    await run("agent-start-codex-json", agent, ["start", "--repo", repo, "--provider", "codex", "--prompt", "hi", "--json"]);
    replies = { "agent:start": { ok: true, data: RECORD } };
    await run("agent-start", agent, ["start", "--repo", repo, "--prompt", "hi", "--account", "work"]);
    replies = { "agent:resume": { ok: true, data: { ...RECORD, lastResumedAt: 2 } } };
    await run("agent-resume", agent, ["resume", "ag-1a2b3c4d", "--prompt", "go on"]);
    await run("agent-resume-json", agent, ["resume", "ag-1a2b3c4d", "--json"]);
    await run("agent-resume-no-id", agent, ["resume"]);
    await run("agent-unknown-verb", agent, ["frobnicate"]);
    await run("agent-help", agent, ["list", "--help"]);

    replies = { "herd:list": { ok: true, data: { herds: [{ ...HERD, jobs: 4 }, { ...HERD, id: "h-two", status: "wrapped", jobs: 1 }] } } };
    await run("herd-list", herdList, []);
    await run("herd-list-json", herdList, ["--json"]);
    replies = { "herd:list": { ok: true, data: { herds: [] } } };
    await run("herd-list-none", herdList, []);
    replies = { "herd:status": { ok: true, data: STATUS } };
    await run("herd-status", herdStatus, ["--herd", "h-sample"]);
    await run("herd-status-json", herdStatus, ["--herd", "h-sample", "--json"]);
    replies = { "herd:gates": { ok: true, data: { gates: [GATE] } } };
    await run("herd-gates", herdGates, ["--herd", "h-sample"]);
    replies = { "herd:gates": { ok: true, data: { gates: [] } } };
    await run("herd-gates-none", herdGates, ["--herd", "h-sample"]);
    replies = { "herd:close": { ok: true, data: { job: "job-a", status: "closed", warning: "a resumable run can still write into this worktree" } } };
    await run("herd-close", herdClose, ["job-a", "--herd", "h-sample"]);
    await run("herd-close-no-job", herdClose, []);
    replies = { "herd:follow-up": { ok: true, data: { job: "job-a", status: "active" } } };
    await run("herd-follow-up", herdFollowUp, ["job-a", "--herd", "h-sample"]);
    replies = { "herd:stop-hidden": { ok: true, data: { stopped: true } } };
    await run("herd-stop", herdStop, ["--hidden"]);
    await run("herd-stop-no-flag", herdStop, []);
    replies = { "herd:status": { ok: false, error: "no such herd: h-x" } };
    await run("herd-status-refused-json", herdStatus, ["--herd", "h-x", "--json"]);

    await run("herd-start-no-session", herdStart, ["--name", "sample", "--repo", repo]);
    await run("herd-ask-outside-worker", herdAsk, ["--questions", "[]"]);
    process.env.CLAUDE_CODE_SESSION_ID = "11111111-2222-3333-4444-555555555555";
    process.env.HERD_ID = "h-sample";
    process.env.HERD_JOB = "job-a";
    process.env.HERDR_WORKSPACE_ID = "w1";
    replies = { "herd:start": { ok: true, data: { herd: "h-sample", room: "herd-h-sample", workspace: "w1", subscription: "sub-1", handle: "ana.1", hidden: true } } };
    await run("herd-start", herdStart, ["--name", "sample", "--repo", repo, "--hidden"]);
    await run("herd-start-json", herdStart, ["--name", "sample", "--repo", repo, "--json"]);
    const SPAWNED = { herd: "h-sample", job: "job-a", pane: "w1:p3", worktree: "/code/wt", branch: "job-a", tree: "wt", wasOnDeck: false, agentId: "ag-1", sessionId: "s2", handle: "job-a.2", trust: "stuck" };
    replies = { "herd:spawn": { ok: true, data: SPAWNED } };
    await run("herd-spawn-stuck", herdSpawn, ["--herd", "h-sample", "--job", "job-a", "--account", "work"]);
    await run("herd-spawn-json", herdSpawn, ["--herd", "h-sample", "--job", "job-a", "--account", "work", "--json"]);
    replies = { "herd:spawn": { ok: true, data: { ...SPAWNED, wasOnDeck: true, trust: "accepted" } } };
    await run("herd-spawn-accepted", herdSpawn, ["--herd", "h-sample", "--job", "job-a", "--account", "work"]);
    await run("herd-spawn-no-job", herdSpawn, ["--herd", "h-sample"]);
    replies = { "herd:resume": { ok: true, data: { subscription: "sub-2", gates: [{ ...GATE, meta: null }], unread: 2, status: STATUS, handle: "ana.1" } } };
    await run("herd-resume", herdResume, ["h-sample"]);
    await run("herd-resume-json", herdResume, ["h-sample", "--json"]);
    replies = { "herd:wrap-up": { ok: true, data: { closed: ["w1:p3", "w1:p4"], workspaceClosed: true, disposed: ["wt"], refused: [{ tree: "wt-b", reason: "dirty worktree" }], deletedJobDirs: false, archived: true } } };
    await run("herd-wrap-up", herdWrapUp, ["h-sample", "--close-panes", "--dispose", "job-a", "--archive-room"]);
    await run("herd-wrap-up-json", herdWrapUp, ["h-sample", "--json"]);
    await run("herd-wrap-up-no-id", herdWrapUp, []);
    replies = { "herd:attend": { ok: true, data: { tab: "t4", pane: "w1:p3" } } };
    await run("herd-attend", herdAttend, ["job-a", "--herd", "h-sample"]);
    await run("herd-attend-json", herdAttend, ["job-a", "--herd", "h-sample", "--json"]);
    const ANSWERED = { gate: "g7", status: "answered", answer: { answers: { q: "yes" }, by: "matt", answeredAt: 1 }, closedReason: null };
    replies = { "herd:answer": { ok: true, data: ANSWERED } };
    await run("herd-answer-answered", herdAnswer, ["g7"]);
    await run("herd-answer-json", herdAnswer, ["g7", "--json"]);
    replies = { "herd:answer": { ok: true, data: { ...ANSWERED, status: "open", answer: null } } };
    await run("herd-answer-open", herdAnswer, ["g7"]);
    replies = { "herd:answer": { ok: true, data: { ...ANSWERED, status: "closed", answer: null, closedReason: "superseded" } } };
    await run("herd-answer-closed", herdAnswer, ["g7"]);
    replies = { "herd:answer": { ok: true, data: { ...ANSWERED, status: "parked", answer: null } } };
    await run("herd-answer-parked", herdAnswer, ["g7"]);
    replies = { "herd:answer": { ok: true, data: { ...ANSWERED, answer: null } } };
    await run("herd-answer-empty", herdAnswer, ["g7"]);
    replies = { "herd:ask": { ok: true, data: { gate: "g8", message: 12 } } };
    await run("herd-ask", herdAsk, ["--questions", JSON.stringify(GATE.questions)]);
    await run("herd-ask-json", herdAsk, ["--questions", JSON.stringify(GATE.questions), "--json"]);
    await run("herd-ask-bad-json", herdAsk, ["--questions", "{"]);
    replies = { "herd:milestone": { ok: true, data: { gate: "g9", message: 13 } } };
    await run("herd-milestone", herdMilestone, ["--artifact", "plan.md", "--summary", "first cut"]);
    await run("herd-milestone-no-artifact", herdMilestone, []);
    const reportFile = join(home, "report.md");
    writeFileSync(reportFile, "all green\n");
    replies = { "herd:report": { ok: true, data: { message: 14 } } };
    await run("herd-report", herdReport, ["--file", reportFile]);
    await run("herd-report-json", herdReport, ["--file", reportFile, "--json"]);
    for (const k of ["CLAUDE_CODE_SESSION_ID", "HERD_ID", "HERD_JOB", "HERDR_WORKSPACE_ID"]) delete process.env[k];

    if (process.env.RT_UPDATE_HPA_BYTES) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      const ascii = JSON.stringify(got, null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      writeFileSync(FIXTURE, ascii + "\n");
    }
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  }, 60_000);
});
