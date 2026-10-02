# rt Output Layer, Phase 6b (herd, pane and agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt herd`, `rt pane` and `rt agent` leave the raw-output allowlist. Off a terminal every verb writes the bytes it writes today, on both streams (agents and skills read them). At a terminal, the five views a person reads (`herd list`, `herd status`, `herd gates`, `pane list`, `agent list`) draw blocks. Three allowlist lines go.

**Architecture:** The 5f2 chat model. Every stdout line goes through `out.payload` or `out.json` with the bytes it had; every stderr line through 6a's `out.diagnostic`. A fixture captured before any edit pins stdout, stderr and the exit code of every verb against a fake daemon socket. Five views get a `show(blocks, frozen)` helper: blocks through `out.print` when `out.isHuman()`, the frozen text through `out.payload` otherwise.

**Tech Stack:** Bun + TypeScript, `bun:test` with a fake daemon over a unix socket (the pattern in `commands/__tests__/pane.test.ts`), the compiled-binary e2e suite, Fast Browser for renders.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369): "Non-goals" (the herd worker verbs), "Rules" 1 to 3, "Block vocabulary", "Status set". **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, 6b rows in section 1, shared items 2 and 8. **Depends on 6a:** `out.diagnostic` (`docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6a-agent-only.md`, Task 2). House style: `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5f2-chat.md`.

**Size:** about 1,400 changed lines (the fixture, about 250 lines, included). One PR.

**What was run while writing this plan:** nothing was compiled. The code was written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name, commit message or PR body. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- 6b only: every `herd`, `pane` and `agent` verb's stdout and stderr off a terminal are byte-identical before and after, `--json` included. `commands/__tests__/fixtures/herd-pane-agent-bytes.json`, captured in Task 3 before any conversion, is the proof and is never regenerated after Task 3. The `rt agent start` codex note is frozen text (it holds a plain `--`, not a long dash) and is not edited.
- Exit codes do not change.
- Blocks are drawn only when `out.isHuman()`; coral only for failures (a crashed job, a dead pane); a job waiting at a gate is `needs-you`, a closed job `off`.
- Copy speaks to "you", plainly; the command to run goes in a `next` callout.
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME.
- Git commands are run plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sample data in tests and renders is invented.
- Files this slice must not edit: every file another phase 6 slice owns; `lib/ui/**`; `lib/mcp/**`; `lib/herd-brief.ts`; every skill.
- UI validation is mandatory (Task 7).

## Review Focus

1. **The shepherd reading `rt herd status --herd <id>` in Bash.** It reads the frozen line format (`subscription MISSING (run rt herd resume)`, `STUCK AT TRUST MODAL`, `SESSION DEAD`). Off a terminal those bytes must not move. Pinned by the fixture entries `herd-status-*` (`every verb writes the bytes it wrote before the output layer`).
2. **`rt herd brief`'s body read by `lib/mcp/herd-tools.ts`.** It is a payload on stdout; at a terminal too it must never be styled. Pinned in Task 6 (`brief stays a payload at a terminal`).
3. **A pane title or a job name carrying an escape sequence, at a terminal.** It must print as text in its cell, never repaint the screen. Pinned in Task 4 (`a hostile pane title is cleaned in the table`).
4. **`rt pane peek` at a terminal.** It prints another program's screen lines; they are a payload and must never be styled. Pinned in Task 4 (`peek is a payload at a terminal`).
5. **A daemon refusal under `--json`.** Today stdout stays empty and the refusal goes to stderr with the `rt <verb>:` prefix. It must stay so. Pinned by the fixture entries `*-refused-json`.

## Readers

| Reader | Reads | After |
|---|---|---|
| `plugins/mattstack/skills/shepherdr/SKILL.md`, `attachments/orchestration/shepherdr/*` | `rt herd spawn`, `stop --hidden`, `attend`, `wrap-up`, `status`, `list`, `resume` in Bash | frozen bytes |
| `lib/mcp/herd-tools.ts:141` | spawns `rt herd brief --job ... --template ...` and reads stdout | frozen payload, at a terminal too |
| `skills/rt-herdr-inject/SKILL.md`, `skills/rt-chat/SKILL.md` | `rt pane send`, `pane spawn`, `pane accounts`, `rt agent start` | frozen bytes |
| `rt-tray/Sources/HerdrBridge.swift:130-314` | runs `herdr`'s own `pane list`, not rt's | unaffected |
| `e2e/tests/herd.test.ts`, `herd-watchdog.test.ts`, `agent.test.ts` | through the real binary | must pass untouched |

## What changes at a terminal (copy table)

| View | Blocks |
|---|---|
| `herd list` | `table` of `[strong(id), status word, dim("room " + room), "<n> job(s)"]`; status `active` as `running`, `wrapped` as `off`. None: `line("skipped", "No herds")` then a `next` callout `rt herd list --all`; under `--all` the callout is dropped (it would point at itself) |
| `herd status` | `section(<herd id>, "room <room>")` holding: a `kv` run (`unread`, `push`, `lifecycle events`); a `table` of jobs `[strong(name), status word, dim("pane " + pane), dim(pane status), gate]`; then every problem `line`, herd-wide ones first (missing or dead subscription, lifecycle off, hidden session down, inbox unreachable), then one per job that needs the shepherd, each with its command in a `next` callout where the table below names one |
| `herd gates` | `table` of `[strong(id), kind, subject, dim(labels)]`. None: `line("skipped", "No open gates")` |
| `pane list` | `table` of `[strong(paneId), agent status word, who, dim(workspace and title), dim(repo and branch), dim(rooms)]`, background panes after a `background` group label. None: `line("skipped", "No Claude panes")` |
| `agent list` | `table` of `[strong(id), repo label, surface, dim(the rest of today's record line)]`. None: `line("skipped", "No agent handoffs yet")` |

Status words and roles:

| Value | Word | Role |
|---|---|---|
| job `spawning` | starting | `pending` |
| job `active` | working | `running` |
| job `at-gate`, `at-milestone` | waiting on you | `needs-you` |
| job `stuck-at-modal` | stuck at a prompt | `needs-you` |
| job `done` | done | `done` |
| job `closed` | closed | `off` |
| job `crashed` | crashed | `failed` |
| pane `working` | working | `running` |
| pane `idle` | idle | `pending` |
| pane `blocked` | waiting on you | `needs-you` |
| pane `done` | done | `done` |
| pane `unknown` | unknown | `skipped` |

Problem lines in `herd status` (each a `line` then, where named, a `next` callout):

| Condition (from `renderStatus`) | Line | next |
|---|---|---|
| `subscription` null | `needs-you`, "This session is not subscribed to the herd" | `rt herd resume <id>` |
| `subscription.dead` | `warn`, "The herd subscription stopped delivering" | `rt herd resume <id>` |
| `!lifecycleConnected` | `warn`, "Lifecycle events are not reaching the herd" | none |
| `hiddenUp === false` | `warn`, "The hidden herd session is down" | none |
| `push.state === "unreachable"` | `warn`, "This session's inbox cannot be reached", hint `last delivery <age>` | none |
| a job `sessionDead` | `failed`, "<job>: the pane is open but Claude is gone" | `rt herd spawn --herd <herd> --job <job>` |
| a job `stuck-at-modal` | `needs-you`, "<job> is waiting at a trust prompt", hint `accept it in pane <pane>` | none |
| a terminal gate delivered to a dead pane | `needs-you`, "<job> did not see the answer to gate <gate>" | `rt chat dm <handle>` |
| `lastGateConsumed === false` | `warn`, "<job> has not read the answer to gate <gate>" | none |
| `watchdog.strikes > 0` | the job's table row hint gains `poked <n>x <age>`; no line | |

## File Structure

| File | Responsibility |
|---|---|
| `commands/__tests__/herd-pane-agent-bytes.test.ts` (create) | the fixture test, fake daemon |
| `commands/__tests__/fixtures/herd-pane-agent-bytes.json` (create, captured) | the bytes before conversion |
| `commands/pane.ts` (modify) | `say`, `show`, `paneListBlocks`; mechanical moves |
| `commands/agent.ts` (modify) | the same, `agentListBlocks` |
| `commands/herd.ts` (modify) | the same, `herdListBlocks`, `herdStatusBlocks`, `herdGatesBlocks` |
| `commands/__tests__/pane.test.ts`, `commands/__tests__/agent.test.ts`, `lib/__tests__/herd-cli.test.ts` (modify) | the `run` harnesses read `captureOut`; block tests |
| `lib/__tests__/raw-output-allowlist.json` (modify) | three lines |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | a paragraph; two renders |

---

### Task 1: Confirm the base

**Files:** none.

- [ ] **Step 1:** Run `git fetch origin`, then `git rebase origin/main`.
- [ ] **Step 2:** Run `grep -n "export function diagnostic" lib/ui/out.ts`. Expected: one line. If empty, **stop**: 6a is not on main; report "6a is not on main" and do not start Task 2.
- [ ] **Step 3:** Run `grep -n "commands/herd.ts\|commands/pane.ts\|commands/agent.ts" lib/__tests__/raw-output-allowlist.json`. Expected: three lines. Fewer: stop and report.
- [ ] **Step 4:** Run `bun test commands/__tests__/pane.test.ts commands/__tests__/agent.test.ts commands/__tests__/agent-fallback.test.ts lib/__tests__/herd-cli.test.ts lib/__tests__/no-raw-output.test.ts`. Expected: PASS; a failure is not this slice's: stop and report.

---

### Task 2: Audit (no code)

Line numbers are `658e704b9`'s.

| File | Site | Kind | Becomes |
|---|---|---|---|
| `commands/pane.ts:38` | `fail` | stderr | `out.diagnostic(\`rt pane: ${msg}\n\`)` |
| `commands/pane.ts:63,87,101,126,145,151,158` | `console.log(JSON.stringify(...))` | `--json` | `out.json(...)` |
| `commands/pane.ts:64` | `no claude panes` | view | `show(() => paneListBlocks([]), () => "no claude panes\n")` |
| `commands/pane.ts:74` | the pane rows | view | `show(() => paneListBlocks(data.panes), () => lines.join("\n") + "\n")` |
| `commands/pane.ts:88` | peek lines | payload | `say(data.lines.join("\n"))` |
| `commands/pane.ts:102,127,128,146,152,153,159` | spawn, send, then, focus, accounts, directories | frozen text | `say(<the same string>)` |
| `commands/agent.ts:38` | `fail` | stderr | `out.diagnostic(\`rt agent: ${msg}\n\`)` |
| `commands/agent.ts:219,237,248,259` | `--json` | `--json` | `out.json(...)` |
| `commands/agent.ts:222,224,240,251` | record lines, the codex note | frozen text | `say(...)` |
| `commands/agent.ts:263,266` | list | view | `show(() => agentListBlocks(data.agents), () => <today's lines>)` |
| `commands/agent.ts:273` | usage on `--help` | frozen text | `say(USAGE)` |
| `commands/herd.ts:35` | `fail` | stderr | `out.diagnostic(\`rt herd: ${msg}\n\`)` |
| `commands/herd.ts:78` | `emit` | both | `json ? out.json(data, 2) : say(line)` |
| `commands/herd.ts:279,282` | gates | view | `show(() => herdGatesBlocks(data.gates), ...)` |
| `commands/herd.ts:331` (`emit` in `status`) | status | view | `json ? out.json(data, 2) : show(() => herdStatusBlocks(data), () => renderStatus(data) + "\n")` |
| `commands/herd.ts:342,345` | list | view | `show(() => herdListBlocks(data.herds), ...)` |
| `commands/herd.ts:365,366,376,412,413` | resume, close warning, wrap-up | frozen text | `say(...)` |

`say(text)` is `out.payload(\`${text}\n\`)`, one per file, as 5f2's `commands/chat.ts` does. Today `herd.ts`'s `emit` prints `JSON.stringify(data, null, 2)` under `--json`: `out.json(data, 2)` writes the same bytes.

---

### Task 3: Pin every byte before converting

**Files:**
- Create: `commands/__tests__/herd-pane-agent-bytes.test.ts`
- Create: `commands/__tests__/fixtures/herd-pane-agent-bytes.json` (captured)

**Interfaces:**
- Consumes: `captureOut({ console: true })`; the three files' exported handlers.
- Produces: the fixture; Tasks 4 to 6 re-run this test unchanged. It covers every `herd`, `pane` and `agent` verb's text form, every `--json` form a skill or agent reads, and a usage or refusal line per file.

- [ ] **Step 1: Write the test**

```ts
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
const ENV_KEYS = ["HERD_ID", "HERD_JOB", "CLAUDE_CODE_SESSION_ID", "HERDR_WORKSPACE_ID", "HERDR_PANE_ID", "CLAUDE_CONFIG_DIR"] as const;
const origEnv: Record<string, string | undefined> = {};
let server: ReturnType<typeof Bun.serve>;
let replies: Record<string, unknown> = {};

beforeAll(() => {
  origHome = process.env.HOME;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-hpa-bytes-")));
  process.env.HOME = home;
  for (const k of ENV_KEYS) {
    origEnv[k] = process.env[k];
    delete process.env[k];
  }
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
  }
  const r = { code, stdout: io.stdout(), stderr: io.stderr() };
  io.restore();
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
    await run("agent-list", agent, ["list", "--repo", "sample-app"]);
    await run("agent-list-json", agent, ["list", "--repo", "sample-app", "--json"]);
    replies = { "agent:list": { ok: true, data: { agents: [] } } };
    await run("agent-list-none", agent, ["list", "--repo", "sample-app"]);
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
```

The worker verbs (`ask`, `milestone`, `report`, `answer`) and `attend` read `HERD_ID`, `HERD_JOB`, `CLAUDE_CODE_SESSION_ID` and `HERDR_WORKSPACE_ID`. The test clears them in `beforeAll` (with `HERDR_PANE_ID`, and `CLAUDE_CONFIG_DIR` so no caller account is looked up through `cswap`), sets the four only around the herd calls that need them, and restores them in `afterAll`. Every `--account` passed to a spawn or start is there for the same reason. Each reply is typed against `Commands[<verb>]["data"]` in `packages/rt-client/src/commands.ts`; if a field differs there, follow the type. `herd-milestone` sends `plan.md` resolved against the cwd to the daemon, and the fake ignores it; only the gate line is printed.

`agent list --repo sample-app` resolves the repo through `resolveRepoArg`, which reads the repo index under the temp HOME and finds nothing: if the capture shows the `--repo` failure instead of a list, drop `--repo sample-app` from those four calls and set `process.chdir(home)` around them so `currentRepoIdentity()` returns nothing and the verb lists every handoff. Record the choice in the ledger.

- [ ] **Step 2: Capture and read**

Run: `RT_UPDATE_HPA_BYTES=1 bun test commands/__tests__/herd-pane-agent-bytes.test.ts`
Expected: PASS; 75 entries (the number of `run(` calls; if the file and this count ever differ, the file wins). Check by eye: `herd-spawn-stuck` ends with ` (cold provision) (STUCK AT TRUST MODAL)`; `herd-resume` holds the resumed line then `  g7  decision  herd:h-sample/job-d`; `herd-wrap-up` ends with `  refused wt-b: dirty worktree`; `agent-start-codex` holds the `note: codex mints its own session id` line; `herd-answer-answered` holds the two-space indented answer JSON; `pane-list` holds a `background:` line before the bg pane; `herd-status` holds `subscription MISSING (run rt herd resume)`, `STUCK AT TRUST MODAL`, `SESSION DEAD`, `worker not woken: rt chat dm job-a` and `UNCONSUMED`; `pane-list-refused` has code 1, stdout empty and stderr `rt pane: herdr unavailable: no socket`; `herd-status-json` is indented by two spaces. If a value changes between runs (an age, a temp path), extend `stable` and capture again. Run twice more without the variable: PASS both times.

- [ ] **Step 3: Commit**

```bash
git add commands/__tests__/herd-pane-agent-bytes.test.ts commands/__tests__/fixtures/herd-pane-agent-bytes.json
```

```bash
git commit -m "herd, pane, agent: pin every byte off a terminal before the output layer touches them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `rt pane`

**Files:**
- Modify: `commands/pane.ts`, `commands/__tests__/pane.test.ts`, `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: `out.*`, `out.diagnostic` (6a).
- Produces: `paneListBlocks(panes: ChatPane[]): Block[]`, exported.

- [ ] **Step 1: Move the test harness onto the capture**

In `commands/__tests__/pane.test.ts`, replace `run` with the `runVerb` body from Task 3 (`captureOut({ console: true })`, `setHuman(() => false)`), returning `{ code, stdout: io.stdout().replace(/\n$/, ""), stderr: io.stderr().replace(/\n$/, "") }` so the existing expectations (which compared `console.log` lines joined by `\n`) still hold. Add the imports. Run `bun test commands/__tests__/pane.test.ts`: PASS with `pane.ts` untouched.

- [ ] **Step 2: Write the failing tests**

Append:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { paneListBlocks } from "../pane.ts";

test("pane list at a terminal: one row per pane, background panes under their own label", () => {
  const text = renderPlain(paneListBlocks([PANE as never, { ...PANE, paneId: "bg:w9:p1", presence: undefined, title: "nightly" } as never]));
  const rows = text.split("\n");
  expect(rows[0]).toMatch(/^w1:p1 +idle +meg +acme · Evaluate codegen +acme · main +#build$/);
  expect(rows[1]).toBe("background:");
  expect(rows[2]).toMatch(/^bg:w9:p1 +idle +not signed in +acme · nightly +acme · main *$/);
});

test("no panes says so", () => {
  expect(renderPlain(paneListBlocks([]))).toBe("[skipped] No Claude panes\n");
});

test("a hostile pane title is cleaned in the table", () => {
  const text = renderPlain(paneListBlocks([{ ...PANE, title: "x\x1b[2Jy\n[ok] forged" } as never]));
  expect(text).not.toContain("\x1b");
  expect(text.split("\n").filter(Boolean)).toHaveLength(1);
});

test("peek is a payload at a terminal", async () => {
  replies = { "pane:peek": { ok: true, data: { paneId: "w1:p1", lines: ["\x1b[1mbold\x1b[0m"] } } };
  const io = captureOut();
  out.__test__.setHuman(() => true);
  try {
    await panePeek(["w1:p1"]);
    expect(io.stdout()).toBe("\x1b[1mbold\x1b[0m\n");
  } finally {
    io.restore();
  }
});
```

(`PANE` in `pane.test.ts` has `repo: "acme"`; the regexes above use it. The rooms cell is last and empty for the bg pane, and the plain renderer pads every cell but the last, so that row ends in spaces: its regex allows them. Import `out` and `captureOut` if Step 1 did not.)

- [ ] **Step 3: Run them to verify they fail**

Run: `bun test commands/__tests__/pane.test.ts -t "terminal|no panes|hostile|payload"`
Expected: FAIL: Bun reports `SyntaxError: Export named 'paneListBlocks' not found in module` when the file loads (a missing named export fails at link time).

- [ ] **Step 4: Implement**

In `commands/pane.ts`, add imports:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
```

Replace `fail`:

```ts
function fail(msg: string): never {
  out.diagnostic(`rt pane: ${msg}\n`);
  process.exit(1);
}
```

Add after `opts`:

```ts
/** One line an agent may be reading: stdout, byte for byte. */
function say(text: string): void {
  out.payload(`${text}\n`);
}

/** Blocks for a person at a terminal; the frozen text for every other reader. */
function show(blocks: () => Block[], frozen: () => string): void {
  if (out.isHuman()) out.print(...blocks());
  else say(frozen());
}

const PANE_STATUS: Record<ChatPane["agentStatus"], { word: string; role: Segment["role"] }> = {
  working: { word: "working", role: "running" },
  idle: { word: "idle", role: "pending" },
  blocked: { word: "waiting on you", role: "needs-you" },
  done: { word: "done", role: "done" },
  unknown: { word: "unknown", role: "skipped" },
};

function paneRow(p: ChatPane): out.CellInput[] {
  const name = p.presence ? (p.presence.name ?? p.presence.handle) : undefined;
  const status = PANE_STATUS[p.agentStatus] ?? PANE_STATUS.unknown;
  const where = [p.workspace, p.title && p.title !== name ? p.title : undefined].filter(Boolean).join(" · ");
  const repo = [p.repo, p.branch].filter(Boolean).join(" · ");
  const rooms = p.presence?.rooms.length ? `#${p.presence.rooms.join(" #")}` : "";
  return [out.strong(p.paneId), { text: status.word, role: status.role }, name ?? out.dim("not signed in"), out.dim(where), out.dim(repo), out.dim(rooms)];
}

export function paneListBlocks(panes: ChatPane[]): Block[] {
  if (panes.length === 0) return [out.line("skipped", "No Claude panes")];
  const visible = panes.filter((p) => !p.paneId.startsWith(BG_PREFIX)).map(paneRow);
  const bg = panes.filter((p) => p.paneId.startsWith(BG_PREFIX)).map(paneRow);
  return [out.table(bg.length > 0 ? [...visible, { group: "background" }, ...bg] : visible)];
}
```

The plain renderer prints the group label as `background:`; check with the expectation in Step 2.

Then rewrite the verbs by Task 2's table. `paneList`:

```ts
export async function paneList(args: string[]): Promise<void> {
  const data = unwrap(await paneListRt(opts(args)), "pane list");
  if (args.includes("--json")) return void out.json({ ok: true, panes: data.panes });
  show(
    () => paneListBlocks(data.panes),
    () => {
      if (data.panes.length === 0) return "no claude panes";
      const idWidth = Math.max(...data.panes.map((p) => p.paneId.length));
      const visible = data.panes.filter((p) => !p.paneId.startsWith(BG_PREFIX));
      const bg = data.panes.filter((p) => p.paneId.startsWith(BG_PREFIX));
      const lines = visible.map((p) => renderPane(p, idWidth));
      if (bg.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push("background:");
        lines.push(...bg.map((p) => renderPane(p, idWidth)));
      }
      return lines.join("\n");
    },
  );
}
```

`panePeek`'s last line: `say(data.lines.join("\n"));`. `paneSpawn`: `say(\`${data.ready ? "ready" : "not ready"}  ${renderPane(data.pane, data.pane.paneId.length)}\`)`. `paneSend`: `say(renderDelivery(first)); if (then) say(\`then: ${first.paneId} ${then.delivered}\`);`. `paneFocus`: `say(renderPaneFocus(data))`. `paneAccounts`: `if (data.accounts.length === 0) return void say("no cswap accounts"); say(<the same map/join>)`. `paneDirectories`: `say(<the same map/join>)`. Every `--json` line: `out.json(<the same object>)`.

Delete `"commands/pane.ts",` from the allowlist.

- [ ] **Step 5: Run**

Run: `bun test commands/__tests__/pane.test.ts commands/__tests__/herd-pane-agent-bytes.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, fixture untouched.
Run: `grep -n "console\." commands/pane.ts`
Expected: no output.
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add commands/pane.ts commands/__tests__/pane.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "pane: frozen bytes off a terminal, a table for a person at one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `rt agent`

**Files:**
- Modify: `commands/agent.ts`, `commands/__tests__/agent.test.ts`, `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Produces: `agentListBlocks(records: AgentRecord[]): Block[]`, added to `__test__`.

- [ ] **Step 1: Write the failing tests**

Append to `commands/__tests__/agent.test.ts`:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";

describe("agent list at a terminal", () => {
  const rec = (over: Partial<AgentRecord>): AgentRecord => ({ id: "ag-1", repo: "sample-app", cwd: "/code/sample-app", provider: "claude", surface: "herdr", sessionId: "s-1", createdAt: 1, ...over }) as AgentRecord;

  test("one row per handoff: id, repo, surface, then the rest", () => {
    const text = renderPlain(__test__.agentListBlocks([rec({ model: "opus", paneId: "w1:p2" }), rec({ id: "ag-2", surface: "headless", finishedAt: 2, exitCode: 1 })]));
    const rows = text.split("\n");
    expect(rows[0]).toMatch(/^ag-1 +sample-app +herdr +provider claude · session s-1 · model opus · pane w1:p2$/);
    expect(rows[1]).toMatch(/^ag-2 +sample-app +headless +provider claude · session s-1 · exit 1$/);
  });

  test("none says so", () => {
    expect(renderPlain(__test__.agentListBlocks([]))).toBe("[skipped] No agent handoffs yet\n");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test commands/__tests__/agent.test.ts -t "at a terminal"`
Expected: FAIL: Bun reports `SyntaxError: Export named 'agentListBlocks' not found in module` when the file loads (a missing named export fails at link time).

- [ ] **Step 3: Implement**

Add `import * as out from "../lib/ui/out.ts";` and `import type { Block } from "../lib/ui/protocol.ts";`. `fail` writes `out.diagnostic(\`rt agent: ${msg}\n\`)`. Add `say` and `show` as in Task 4. Add:

```ts
function recordRest(r: AgentRecord): string {
  return [
    `provider ${r.provider}`,
    `session ${r.sessionId}`,
    r.handle && `chat ${r.name ?? r.handle}`,
    r.model && `model ${r.model}`,
    r.account && `account ${r.account}`,
    r.yolo && "yolo",
    r.paneId && `pane ${r.paneId}`,
    r.finishedAt !== undefined && (r.exitCode !== undefined ? `exit ${r.exitCode}` : "finished"),
    r.lastResumedAt !== undefined && "resumed",
  ]
    .filter(Boolean)
    .join(" · ");
}

function agentListBlocks(records: AgentRecord[]): Block[] {
  if (records.length === 0) return [out.line("skipped", "No agent handoffs yet")];
  return [out.table(records.map((r) => [out.strong(r.id), repoLabel(r.repo), r.surface, out.dim(recordRest(r))]))];
}
```

`renderRecord` stays as it is (it is the frozen form). In `runList`:

```ts
  if (args.includes("--json")) {
    out.json({ ok: true, agents: data.agents });
    return;
  }
  show(
    () => agentListBlocks(data.agents),
    () => (data.agents.length === 0 ? "no agent handoffs recorded" : data.agents.map(renderRecord).join("\n")),
  );
```

`runStart`, `runResume`, `runShow`: `--json` lines become `out.json({ ok: true, agent: data })`; `console.log(renderRecord(data))` becomes `say(renderRecord(data))`; the codex note becomes `say(<the same template literal>)`, copied character for character from the source. `usage()` becomes `say(USAGE)`. Add `agentListBlocks` to `__test__`. Delete `"commands/agent.ts",` from the allowlist.

- [ ] **Step 4: Run**

Run: `bun test commands/__tests__/agent.test.ts commands/__tests__/agent-fallback.test.ts commands/__tests__/herd-pane-agent-bytes.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, fixture untouched.
Run: `grep -n "console\." commands/agent.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add commands/agent.ts commands/__tests__/agent.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "agent: frozen bytes off a terminal, a table of handoffs for a person at one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `rt herd`

**Files:**
- Modify: `commands/herd.ts`, `lib/__tests__/herd-cli.test.ts`, `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Produces: `herdListBlocks(herds: HerdListRow[], all?: boolean): Block[]`, `herdStatusBlocks(data: HerdStatusData): Block[]`, `herdGatesBlocks(gates: GateRow[]): Block[]`, exported.

- [ ] **Step 1: Move `lib/__tests__/herd-cli.test.ts`'s `run` onto the capture**

As Task 4 Step 1. Run the file: PASS with `herd.ts` untouched.

- [ ] **Step 2: Write the failing tests**

Append to `lib/__tests__/herd-cli.test.ts` (each import only if Step 1 did not already add it; a second import of the same name is a `SyntaxError`):

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { herdGatesBlocks, herdListBlocks, herdStatusBlocks } from "../../commands/herd.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

describe("herd views at a terminal", () => {
  const herd = { id: "h-sample", repo: "sample-app", room: "herd-h-sample", workspace: "w1", shepherdSession: "s", shepherdHandle: "ana.1", shepherdName: "ana", herdrSocket: null, hidden: false, status: "active" as const, createdAt: 1, wrappedAt: null };
  const job = { herd: "h-sample", name: "job-a", worktree: "/code/wt", branch: "job-a", tree: "wt", pane: "w1:p3", agentSession: "s2", agentId: null, handle: "job-a.2", handleName: "job-a", status: "active" as const, disposable: false, lastGate: null, lastReport: null, createdAt: 1, updatedAt: 1, openGate: null, paneStatus: "working", sessionDead: false, lastGateStatus: null, lastGateDelivery: null, lastGateConsumed: null };

  test("list: one row per herd; a wrapped herd reads as off", () => {
    const text = renderPlain(herdListBlocks([{ ...herd, jobs: 2 }, { ...herd, id: "h-two", status: "wrapped", jobs: 1 }]));
    expect(text.split("\n")[0]).toMatch(/^h-sample +active +room herd-h-sample +2 jobs$/);
    expect(text.split("\n")[1]).toMatch(/^h-two +wrapped +room herd-h-sample +1 job$/);
    expect(renderPlain(herdListBlocks([]))).toBe("[skipped] No herds\n  next: rt herd list --all\n");
    expect(renderPlain(herdListBlocks([], true))).toBe("[skipped] No herds\n");
  });

  test("status: a healthy herd is a heading, its numbers and its jobs, with no problem lines", () => {
    const data = { herd, jobs: [job], unread: 0, lifecycleConnected: true, hiddenUp: null, subscription: { id: "sub-1", dead: false, lastDelivery: null }, push: { state: "reachable" as const, lastDelivery: null } };
    const text = renderPlain(herdStatusBlocks(data as never));
    expect(text).toContain("h-sample");
    expect(text).toMatch(/job-a +working +pane w1:p3/);
    expect(text).not.toContain("[warning]");
    expect(text).not.toContain("[needs you]");
  });

  test("status: every problem the shepherd must act on is its own line, with the command that fixes it", () => {
    const data = {
      herd,
      jobs: [
        { ...job, name: "job-b", status: "stuck-at-modal" as const, pane: "w1:p4" },
        { ...job, name: "job-c", sessionDead: true },
        { ...job, name: "job-d", status: "at-gate" as const, lastGate: "g7", lastGateStatus: "answered" as const, lastGateDelivery: "dead-pane" as const, lastGateConsumed: false },
      ],
      unread: 3,
      lifecycleConnected: false,
      hiddenUp: false,
      subscription: null,
      push: { state: "unreachable" as const, lastDelivery: null },
    };
    const text = renderPlain(herdStatusBlocks(data as never));
    expect(text).toContain("[needs you] This session is not subscribed to the herd\n  next: rt herd resume h-sample");
    expect(text).toContain("[warning] Lifecycle events are not reaching the herd");
    expect(text).toContain("[warning] The hidden herd session is down");
    expect(text).toContain("[warning] This session's inbox cannot be reached");
    expect(text).toContain("[needs you] job-b is waiting at a trust prompt  accept it in pane w1:p4");
    expect(text).toContain("[failed] job-c: the pane is open but Claude is gone\n  next: rt herd spawn --herd h-sample --job job-c");
    expect(text).toContain("[needs you] job-d did not see the answer to gate g7\n  next: rt chat dm job-a");
    expect(text).toContain("[warning] job-d has not read the answer to gate g7");
  });

  test("gates: one row per open gate; none says so", () => {
    const g = { id: "g7", subject: "herd:h-sample/job-d", kind: "decision", questions: [{ id: "q", label: "Ship it?", multi: false, options: ["yes"] }] };
    expect(renderPlain(herdGatesBlocks([g as never]))).toMatch(/^g7 +decision +herd:h-sample\/job-d +Ship it\?\n$/);
    expect(renderPlain(herdGatesBlocks([]))).toBe("[skipped] No open gates\n");
  });
});
```

And inside the existing `describe("rt herd brief", ...)` block (it defines `tmpFile` and `TEMPLATE`), after its `brief prints the assembled text plain, or as JSON with --json` test:

```ts
  test("brief stays a payload at a terminal", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const io = captureOut();
    out.__test__.setHuman(() => true);
    try {
      await brief(["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=ship it"]);
      expect(io.stdout().startsWith("# Job: widget\n")).toBe(true);
      expect(io.stdout()).not.toContain("\x1b");
      expect(io.stderr()).toBe("");
    } finally {
      io.restore();
    }
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun test lib/__tests__/herd-cli.test.ts -t "at a terminal"`
Expected: FAIL: Bun reports `SyntaxError: Export named 'herdListBlocks' not found in module` when the file loads (a missing named export fails at link time).

- [ ] **Step 4: Implement**

In `commands/herd.ts`, add:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block, Segment } from "../lib/ui/protocol.ts";
import type { GateRow } from "../packages/rt-client/src/index.ts";
```

`fail` becomes `out.diagnostic(\`rt herd: ${msg}\n\`); process.exit(1);`. Add `say` and `show` as in Task 4, and:

```ts
function emit(json: boolean, data: unknown, line: string): void {
  if (json) out.json(data, 2);
  else say(line);
}

const JOB_STATUS: Record<HerdStatusData["jobs"][number]["status"], { word: string; role: Segment["role"] }> = {
  spawning: { word: "starting", role: "pending" },
  active: { word: "working", role: "running" },
  "at-gate": { word: "waiting on you", role: "needs-you" },
  "at-milestone": { word: "waiting on you", role: "needs-you" },
  "stuck-at-modal": { word: "stuck at a prompt", role: "needs-you" },
  done: { word: "done", role: "done" },
  closed: { word: "closed", role: "off" },
  crashed: { word: "crashed", role: "failed" },
};

export function herdListBlocks(herds: HerdListRow[], all = false): Block[] {
  if (herds.length === 0) return all ? [out.line("skipped", "No herds")] : [out.line("skipped", "No herds"), out.callout("next", out.cmd("rt herd list --all"))];
  return [
    out.table(
      herds.map((h) => [out.strong(h.id), { text: h.status, role: h.status === "active" ? "running" : "off" }, out.dim(`room ${h.room}`), `${h.jobs} ${h.jobs === 1 ? "job" : "jobs"}`]),
    ),
  ];
}

export function herdGatesBlocks(gates: GateRow[]): Block[] {
  if (gates.length === 0) return [out.line("skipped", "No open gates")];
  return [out.table(gates.map((g) => [out.strong(g.id), g.kind, g.subject, out.dim(g.questions.map((q) => q.label).join(" | "))]))];
}

export function herdStatusBlocks(data: HerdStatusData): Block[] {
  const id = data.herd.id;
  const facts = [out.kv("unread", String(data.unread)), out.kv("push", `${data.push.state}, last delivery ${pushAge(data.push.lastDelivery)}`)];
  const problems: Block[] = [];
  if (!data.subscription) problems.push(out.line("needs-you", "This session is not subscribed to the herd"), out.callout("next", out.cmd(`rt herd resume ${id}`)));
  else if (data.subscription.dead) problems.push(out.line("warn", "The herd subscription stopped delivering"), out.callout("next", out.cmd(`rt herd resume ${id}`)));
  if (!data.lifecycleConnected) problems.push(out.line("warn", "Lifecycle events are not reaching the herd"));
  if (data.hiddenUp === false) problems.push(out.line("warn", "The hidden herd session is down"));
  if (data.push.state === "unreachable") problems.push(out.line("warn", "This session's inbox cannot be reached", `last delivery ${pushAge(data.push.lastDelivery)}`));
  const rows: out.CellInput[][] = [];
  for (const j of data.jobs) {
    const s = JOB_STATUS[j.status];
    const poked = j.watchdog && j.watchdog.strikes > 0 ? `poked ${j.watchdog.strikes}x${j.watchdog.lastPokeAt === null ? "" : ` ${ago(j.watchdog.lastPokeAt)}`}` : "";
    rows.push([out.strong(j.name), { text: s.word, role: s.role }, out.dim(`pane ${j.pane ?? "-"}`), out.dim([j.paneStatus ?? "-", j.openGate ? `gate ${j.openGate}` : "", poked].filter(Boolean).join(" · "))]);
    if (j.sessionDead) problems.push(out.line("failed", `${j.name}: the pane is open but Claude is gone`), out.callout("next", out.cmd(`rt herd spawn --herd ${j.herd} --job ${j.name}`)));
    if (j.status === "stuck-at-modal") problems.push(out.line("needs-you", `${j.name} is waiting at a trust prompt`, `accept it in pane ${j.pane ?? "-"}`));
    const terminal = j.lastGateStatus === "answered" || j.lastGateStatus === "closed";
    if (terminal && j.lastGateDelivery === "dead-pane") problems.push(out.line("needs-you", `${j.name} did not see the answer to gate ${j.lastGate}`), out.callout("next", out.cmd(`rt chat dm ${j.handleName ?? j.handle}`)));
    if (j.lastGateConsumed === false) problems.push(out.line("warn", `${j.name} has not read the answer to gate ${j.lastGate}`));
  }
  return [out.section(id, `room ${data.herd.room}`, ...facts, ...(rows.length > 0 ? [out.table(rows)] : [out.line("skipped", "No jobs yet")]), ...problems)];
}
```

The `kv` run carries no lifecycle row: lifecycle is a problem line when off and silent when on, so the healthy herd reads clean.

Rewrite the verbs: `status`: `if (json) out.json(data, 2); else show(() => herdStatusBlocks(data), () => renderStatus(data));`. `list`: `if (json) return void out.json(data, 2); show(() => herdListBlocks(data.herds, has(args, "--all")), () => (data.herds.length === 0 ? "no herds" : data.herds.map(renderHerdRow).join("\n")));`. `gates`: the same shape with `herdGatesBlocks` and the frozen `no open gates` / row lines. `resume`, `close`, `wrapUp`: each `console.log(x)` becomes `say(x)` with the same string. `brief`'s two `emit` calls are unchanged (they go through `emit`, now `say`), so its body is a payload at a terminal too.

Delete `"commands/herd.ts",` from the allowlist.

- [ ] **Step 5: Run**

Run: `bun test lib/__tests__/herd-cli.test.ts commands/__tests__/herd-pane-agent-bytes.test.ts lib/__tests__/no-raw-output.test.ts lib/mcp`
Expected: PASS, fixture untouched.
Run: `grep -n "console\." commands/herd.ts`
Expected: no output.
Run: `bun run typecheck`
Expected: no errors.
Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/herd.test.ts e2e/tests/herd-watchdog.test.ts e2e/tests/agent.test.ts`
Expected: PASS with no edit.

- [ ] **Step 6: Commit**

```bash
git add commands/herd.ts lib/__tests__/herd-cli.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "herd: frozen bytes off a terminal; list, status and gates draw blocks for a person, with each problem on its own line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Renders, AGENTS.md and every gate

**Files:** `AGENTS.md`, `docs/design/output-layer/README.md`, `docs/design/output-layer/6b-herd-pane-agent-dark.png`, `6b-herd-pane-agent-light.png`.

- [ ] **Step 1: Render input.** Run `bun run ui:build`. In the scratchpad write `blocks-6b.ts` that imports `herdListBlocks`, `herdStatusBlocks`, `herdGatesBlocks` from `<repo>/commands/herd.ts`, `paneListBlocks` from `<repo>/commands/pane.ts` and `__test__` from `<repo>/commands/agent.ts`, builds the same sample data as Task 3's fixture (a two-herd list, the four-job status, one gate, the two panes, two handoffs), and writes `encodeLine({ t: "hello", protocol: 1 })` then each block's `encodeLine` to stdout, as 5f2's Task 7 Step 1 does. Copy 5f2's `ansi-page.ts` unchanged.
- [ ] **Step 2: Render both schemes.** Run, one at a time from the scratchpad: `bun blocks-6b.ts > 6b.ndjson`; `COLORTERM=truecolor TERM=xterm-256color RT_UI_BACKGROUND=dark <repo>/ui/dist/rt-ui render --width 100 < 6b.ndjson > 6b-dark.ansi`; the same with `RT_UI_BACKGROUND=light` into `6b-light.ansi`; `bun ansi-page.ts dark 6b < 6b-dark.ansi > 6b-dark.html`; `bun ansi-page.ts light 6b < 6b-light.ansi > 6b-light.html`.
- [ ] **Step 3: Screenshot and look.** Serve the scratchpad on 127.0.0.1, screenshot both pages with Fast Browser, save as the two PNGs. Write down plainly what reads wrong, checking: a crashed or dead-session job is the only coral; waiting jobs read as needing you, not failing; the `background` label separates the bg panes; the status section's problem lines sit under its job table with their `next` commands aligned; nothing clips at 100 columns. Fix faults in Tasks 4 to 6's code and re-render.
- [ ] **Step 4: README row**

```markdown
| `6b-herd-pane-agent-dark.png`, `6b-herd-pane-agent-light.png` | `rt herd list`, `status` (a healthy job and every problem line) and `gates`, `rt pane list` with a background pane, and `rt agent list`. Off a terminal these verbs print exactly what they printed before |
```

- [ ] **Step 5: AGENTS.md** (append to "Output layer", wrapped at about 78 columns):

```markdown
`rt herd`, `rt pane` and `rt agent` follow chat's rule: off a terminal
every verb writes the bytes it always wrote (`say` and `out.json` on
stdout, `out.diagnostic` on stderr), pinned by
`commands/__tests__/fixtures/herd-pane-agent-bytes.json`; only `herd
list`, `herd status`, `herd gates`, `pane list` and `agent list` draw
blocks, and only when a person is at the terminal.
```

- [ ] **Step 6: Gates.** Run, one at a time: `bun run ui:build`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`. Expected: all pass (known flakes as in 6a Task 8).
- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/6b-herd-pane-agent-dark.png docs/design/output-layer/6b-herd-pane-agent-light.png
```

```bash
git commit -m "docs: herd, pane and agent keep their bytes for agents, with renders of the views a person reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`. Merge the allowlist, `AGENTS.md` and the README by hand (keep both sides).
- [ ] **Step 2:** Re-run the eight gates. The fixture passes as committed.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; expect about 1,400 lines; put the number in the report.
- [ ] **Step 4:** Push with the `git_push` MCP tool. Body in `<scratchpad>/pr-body-6b.md`: a framing paragraph; **Frozen** (every verb's bytes off a terminal, the fixture); **Views** (five, what each draws); the renders; gate results; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Run `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6b, herd-pane-agent" --body-file <scratchpad>/pr-body-6b.md`.
- [ ] **Step 5:** Report the URL, gates, size and what the renders showed. Do not merge.

---

## Decisions this plan made

1. **Five views draw blocks; every other verb is frozen.** `herd spawn`, `ask`, `milestone`, `report`, `answer`, `close`, `resume`, `wrap-up`, `attend`, `brief`, `pane send`, `spawn`, `peek`, `focus`, `accounts`, `directories`, `agent start`, `resume`, `show` are run by agents far more than by a person; they keep one plain form.
2. **`herd status` at a terminal splits problems out of the row** into lines with a `next` each, where today's one row carries them in capitals. Off a terminal the capitals stay: the shepherd matches them.
3. **`--json` under `herd` keeps its two-space indent** (`out.json(data, 2)`), byte for byte.

## Self-Review

**Spec coverage.** "Non-goals": herd worker verbs unchanged (Task 6, fixture). Rules 1 to 3: payloads unstyled (peek, brief), human views on stdout, failures on stderr unchanged in bytes (6a's `out.diagnostic`). Scoping shared items 2 (consumed) and 8 (Task 3). Three allowlist lines (Tasks 4 to 6).

**Placeholders.** None. `<repo>` and `<scratchpad>` are the implementer's own paths.

**Type consistency.** `say`, `show(blocks, frozen)`, `paneListBlocks`, `agentListBlocks`, `herdListBlocks`, `herdStatusBlocks`, `herdGatesBlocks` match across tasks.

**Review Focus.** Five lines, each pinned by a named test or fixture entry.
