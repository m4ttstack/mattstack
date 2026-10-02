# rt Output Layer, Phase 6a (agent-only verbs and the exemption list) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent-only verbs (`gate`, `events`, `mcp`, `ci`, `runs find`, the run-tracking writes, `worktree claude-hook`) leave the raw-output allowlist with every byte they write unchanged; the three person-run hook verbs (`worktree hook install`, `uninstall`, `status`) draw blocks; and the three logging and parsing seams that must touch a stream go on a new, tested, permanent exemption list. Ten allowlist lines go.

**Architecture:** The spec leaves agent-only verbs unconverted ("a mechanical change with no wording involved"). Stdout moves onto `out.json` and `out.payload`; stderr moves onto a new `out.diagnostic`, the stderr twin of `out.payload` (byte for byte, never styled). A characterization fixture captured before any edit pins stdout, stderr and the exit code of every verb reachable without a daemon; the daemon-backed paths are pinned by the existing e2e suites, which must pass untouched. The guard learns a second list, `lib/__tests__/raw-output-exemptions.json`, each entry a file, a reason and the exact count of raw lines it may hold, so an exemption can never grow without a reviewed edit.

**Tech Stack:** Bun + TypeScript, `bun:test`, the compiled-binary e2e suite (`e2e/tests/`), Fast Browser for the renders. No Go change.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369): "Non-goals" (agent-only verbs), "Guard" (the two ways a non-printing offender leaves), "Rules" 1 and 3. **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, rows for 6a in section 1, shared items 1, 2, 4 and 8 in section 3, warnings rows 50 and 51. House style follows `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5f2-chat.md`.

**Size:** about 1,300 changed lines (the captured fixture, about 150 lines, included). One PR. Task 9 measures it.

**What was run while writing this plan:** nothing was compiled. The code was written against `origin/main` at `658e704b9`; line numbers are that commit's.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name, commit message or PR body. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` keeps its shape: keys, structure, types and machine-read values byte for byte. In this slice that extends to every byte on stdout and stderr of every agent-only verb (spec "Non-goals"; scoping section 1). The fixture captured in Task 3 is the proof and is never regenerated after Task 3.
- Exit codes do not change.
- Human text goes to stdout, failures to stderr through `out.fail`, policy refusals as `refused` notes; coral only for failures. Applies to the three person-run hook verbs only.
- Copy speaks to "you", plainly, with no flags, paths, store names or ids in sentences; the command to run goes in a `next` callout.
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME (`env -i HOME=<temp> PATH="$PATH" ...`).
- Git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sample data in tests and renders is invented.
- Files this slice must not edit: every file another phase 6 slice owns (scoping section 4), `lib/ui/**` except the two exports Task 2 adds to `lib/ui/out.ts`, `lib/ui/__tests__/capture-out.ts`, `ui/**`, every skill.
- UI validation is mandatory: Task 8 renders the hook verbs and the two warnings dark and light and says plainly what reads wrong.

## Review Focus

1. **An agent running `rt gate wait <id>` in Bash while the daemon drops.** Today it reads `rt gate: wait failed (...); retrying until reconnect...` once on stderr, then JSON on stdout. Both streams must be the same bytes after. Pinned in Task 3's fixture (`gate-wait-retry-then-answered`, which drives `waitForGate` with a `wait` that fails once) and by `e2e/tests/gate-answer.test.ts`, untouched.
2. **Claude Code's WorktreeCreate hook reading `rt worktree claude-hook`'s stdout.** stdout must be the path and a newline, nothing else, and a refusal must leave stdout empty with exit 2. Pinned in Task 6 (`claude-hook writes only the path on stdout`, `a refusal leaves stdout empty and exits 2`).
3. **`rt mcp tools --json` through a pipe.** The roster is larger than a pipe buffer and the CLI exits right after; it must arrive whole. Pinned by `commands/__tests__/no-mcp-tools-pipe.test.ts`, untouched, after Task 5 moves the write onto `out.jsonFlushed`.
4. **An exempt file that gains a raw line.** A new `console.log` in `lib/daemon-logger.ts` must fail the guard, not ride the exemption. Pinned in Task 4 (`an exempt file holds exactly the raw lines its entry allows`).
5. **A file both exempt and allowlisted, or exempt and not printing at all.** The guard must say which list to fix. Pinned in Task 4 (`no file is both exempt and allowlisted`, `an exempt file that no longer prints raw is removed from the exemptions`).

## Readers of this slice's output

| Reader | Reads | After this slice |
|---|---|---|
| eight skills (`skills/rt-worktree`, `rt-sdm-connect`, `rt-chat`, `apps/board/skills/review`, `respond`, `doctor`, `plugins/mattstack/attachments/gate-protocol`, shepherdr) | `rt gate wait`, `answer`, `park`, `ask` stdout JSON and exit codes | unchanged bytes (Task 3 fixture, e2e) |
| `apps/board` | gate and events JSON through the daemon, not the CLI | unaffected |
| `plugins/mattstack/hooks/pipeline-gate-stop.sh` | `rt runs find --session <id> --running` stdout JSON | unchanged bytes (Task 3 fixture) |
| the pipeline skills | `rt runs run-start`, `stage-*`, `field`, `decision`, `snapshot` stdout JSON | unchanged bytes (Task 3 fixture, `runs-write.test.ts`) |
| Claude Code (MCP stdio) | `rt mcp serve`'s JSON-RPC on stdout | unaffected: the SDK writes it, not `commands/mcp.ts` |
| `plugins/mattstack` reference check, `no-mcp-tools-pipe.test.ts` | `rt mcp tools --json` | unchanged bytes |
| Claude Code's WorktreeCreate and WorktreeRemove hooks | `rt worktree claude-hook` stdout path, exit code; stderr shown to the person on a refusal | unchanged bytes (Task 6) |
| `skills/rt-worktree/SKILL.md:289-345` | `rt worktree hook status --json` | unchanged envelope (Task 3 fixture) |
| `plugins/mattstack/docs/superpowers/tests/2026-09-23-*/scenarios/*.md` | quote `rt gate: context omitted: ...` | historical test scenarios; the bytes do not change anyway |

## What this slice adds to the layer

```ts
// lib/ui/out.ts
/** A --json envelope written as json() writes it; resolves when the write has flushed. */
export function jsonFlushed(value: unknown, indent?: number): Promise<void>;
/** Stderr text an agent-only verb writes for the program that ran it: byte for byte, never styled. */
export function diagnostic(text: string): void;
```

6b calls `out.diagnostic`. Nobody else calls either.

## File Structure

| File | Responsibility |
|---|---|
| `lib/ui/out.ts` (modify) | `jsonFlushed`, `diagnostic` |
| `lib/ui/__tests__/out.test.ts` (modify) | their tests |
| `lib/__tests__/raw-output-exemptions.json` (create) | three permanent exemptions |
| `lib/__tests__/no-raw-output.test.ts` (modify) | reads the exemptions; four new tests |
| `commands/__tests__/agent-verbs-bytes.test.ts` (create) | the characterization fixture test |
| `commands/__tests__/fixtures/agent-verbs-bytes.json` (create, captured) | the bytes before conversion |
| `commands/gate.ts`, `events.ts`, `mcp.ts`, `ci.ts`, `runs-find.ts`, `runs-write.ts` (modify) | onto `out.json`, `out.jsonFlushed`, `out.payload`, `out.diagnostic` |
| `commands/worktree-hook.ts` (modify) | `claude-hook` mechanical; hook verbs on blocks; two warnings on `warn` |
| `commands/__tests__/worktree-hook.test.ts` (modify) | the hook verbs' blocks, the hook's stdout |
| `lib/__tests__/raw-output-allowlist.json` (modify) | ten lines deleted |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | one paragraph; two renders |

---

### Task 1: Confirm the base

No code.

**Files:** none.

**Interfaces:**
- Consumes: nothing.
- Produces: a go or a stop for every later task.

- [ ] **Step 1: Bring main in**

Run: `git fetch origin`
Run: `git rebase origin/main`

- [ ] **Step 2: Check what this slice leans on**

Run each alone from the repo root:

- `grep -n "export function warn\|export function setWarningLog" lib/ui/warn.ts`
- `grep -n "export function payload\|export function json\|export function note" lib/ui/out.ts`
- `grep -n "console?: boolean" lib/ui/__tests__/capture-out.ts`
- `grep -c "" lib/__tests__/raw-output-allowlist.json`

Expected: the first three print at least one line each. If any is empty, **stop**: report which file lacks which export. The allowlist must still hold the ten files of this slice; run `grep -n "commands/gate.ts\|commands/events.ts\|commands/mcp.ts\|commands/ci.ts\|commands/runs-find.ts\|commands/runs-write.ts\|commands/worktree-hook.ts\|lib/cli-logger.ts\|lib/daemon-logger.ts\|lib/daemon/inject.ts" lib/__tests__/raw-output-allowlist.json` and expect ten lines. If fewer, another branch converted one: stop and report which.

Run: `test -e lib/__tests__/raw-output-exemptions.json && echo exists`
Expected: no output. If it prints `exists`, another slice created the file first: stop and report.

- [ ] **Step 3: Baseline**

Run: `bun test lib/__tests__/no-raw-output.test.ts commands/__tests__/gate.test.ts commands/__tests__/gate-ask-cli.test.ts commands/__tests__/gate-fork-check-cli.test.ts commands/__tests__/ci.test.ts commands/__tests__/runs-find.test.ts commands/__tests__/runs-write.test.ts commands/__tests__/worktree-hook.test.ts commands/__tests__/mcp-tools-list.test.ts commands/__tests__/no-mcp-tools-pipe.test.ts lib/ui/__tests__/out.test.ts`
Expected: PASS. A failure here is not this slice's: stop and report it.

---

### Task 2: `out.jsonFlushed` and `out.diagnostic`

**Files:**
- Modify: `lib/ui/out.ts` (after `payload`)
- Modify: `lib/ui/__tests__/out.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `jsonFlushed(value: unknown, indent?: number): Promise<void>`; `diagnostic(text: string): void`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ui/__tests__/out.test.ts` (it already imports `out` and `captureOut`; add the imports if a name is missing):

```ts
describe("the two writers agent-only verbs use", () => {
  test("diagnostic writes stderr byte for byte, at a terminal too, and never stdout", () => {
    const io = captureOut();
    out.__test__.setHuman(() => true);
    try {
      out.diagnostic("rt gate: usage: rt gate park <id>\n");
      expect(io.stderr()).toBe("rt gate: usage: rt gate park <id>\n");
      expect(io.stdout()).toBe("");
    } finally {
      io.restore();
    }
  });

  test("jsonFlushed writes what json writes and resolves after the write", async () => {
    const io = captureOut();
    try {
      const value = { tools: [{ name: "a" }, { name: "b" }] };
      out.json(value);
      const viaJson = io.stdout();
      io.clear();
      await out.jsonFlushed(value);
      expect(io.stdout()).toBe(viaJson);
      io.clear();
      await out.jsonFlushed(value, 2);
      expect(io.stdout()).toBe(JSON.stringify(value, null, 2) + "\n");
    } finally {
      io.restore();
    }
  });
});
```

`captureOut` replaces `process.stdout.write` with a function that takes one argument and returns `true` without calling a callback, so `jsonFlushed` must also resolve when the writer returns without calling back. The implementation below handles that by resolving on whichever comes first: the callback, or a writer that reports the chunk was taken (`true`) and is not a real stream.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/ui/__tests__/out.test.ts -t "agent-only verbs use"`
Expected: FAIL, `out.diagnostic is not a function`.

- [ ] **Step 3: Implement**

In `lib/ui/out.ts`, after `payload`:

```ts
/**
 * A --json envelope written as json() writes it, resolving once the write has
 * flushed: a verb that exits right after a payload larger than a pipe buffer
 * would otherwise cut it short.
 */
export function jsonFlushed(value: unknown, indent?: number): Promise<void> {
  const text = JSON.stringify(value, null, indent) + "\n";
  return new Promise<void>((resolve, reject) => {
    const taken = process.stdout.write(text, (err) => (err ? reject(err) : resolve()));
    if (taken && process.stdout.write.length < 2) resolve();
  });
}

/**
 * Stderr text an agent-only verb writes for the program that ran it, byte for
 * byte and never styled: the stderr twin of payload(). A failure a person
 * reads goes through fail().
 */
export function diagnostic(text: string): void {
  process.stderr.write(text);
}
```

`process.stdout.write.length < 2` is true only for a test double that takes one parameter; the real stream's `write` declares its callback.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test lib/ui/__tests__/out.test.ts`
Expected: PASS.
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/out.ts lib/ui/__tests__/out.test.ts
```

```bash
git commit -m "ui: out.jsonFlushed and out.diagnostic for the agent-only verbs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pin every byte the agent-only verbs write, before converting them

No change to any verb. The fixture is captured from today's code and never regenerated after this task.

**Files:**
- Create: `commands/__tests__/agent-verbs-bytes.test.ts`
- Create: `commands/__tests__/fixtures/agent-verbs-bytes.json` (captured)

**Interfaces:**
- Consumes: `captureOut({ console: true })` (phase 4); the verbs' exported handlers.
- Produces: `runVerb(fn, args, opts?)` in the test file, returning `{ code, stdout, stderr }`; Tasks 5 and 6 re-run this test unchanged.

- [ ] **Step 1: Write the fixture test**

Create `commands/__tests__/agent-verbs-bytes.test.ts`:

```ts
/**
 * The agent-only verbs keep every byte they write (spec "Non-goals"). This
 * captures stdout, stderr and the exit code of each path reachable without a
 * daemon; the daemon-backed paths are the e2e suites'. The fixture is
 * captured once, from the unconverted code, and never regenerated.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { gateAnswer, gateClose, gateList, gatePark, gateSubscribe, gateUnsubscribe, gateWait, gateAsk, waitForGate } from "../gate.ts";
import { eventsEmit, eventsList, eventsTail, eventsWait } from "../events.ts";
import { mcpToolsList, mcpToolsPayload } from "../mcp.ts";
import { ciLeaseClaim, ciLeaseHeartbeat, ciLeaseRelease, ciLeaseShow } from "../ci.ts";
import { runsFind } from "../runs-find.ts";
import { runsRunStart, runsStageStart } from "../runs-write.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "agent-verbs-bytes.json");

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

let home: string;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "rt-agent-bytes-"));
  for (const k of ["RT_DAEMON_SOCK", "RT_RUNS_ROOT", "RT_RUN_EMIT", "MATTSTACK_ATTENDANTS_DIR", "CLAUDE_CODE_SESSION_ID"]) saved[k] = process.env[k];
  // A socket path nothing listens on: every daemon call fails fast and the
  // same way on every machine.
  process.env.RT_DAEMON_SOCK = join(home, "no-daemon.sock");
  process.env.RT_RUNS_ROOT = join(home, "runs");
  process.env.RT_RUN_EMIT = "0";
  process.env.MATTSTACK_ATTENDANTS_DIR = join(home, "attendants");
  process.env.CLAUDE_CODE_SESSION_ID = "s1";
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});

describe("agent-only verbs (frozen bytes)", () => {
  test("every captured path writes what it wrote before the output layer", async () => {
    const got: Record<string, { code: number; stdout: string; stderr: string }> = {};
    const stable = (s: string) => s.replaceAll(home, "<home>");
    const run = async (name: string, fn: (args: string[]) => Promise<void>, args: string[]) => {
      const r = await runVerb(fn, args);
      got[name] = { code: r.code, stdout: stable(r.stdout), stderr: stable(r.stderr) };
    };

    await run("gate-wait-no-id", gateWait, []);
    await run("gate-wait-bad-timeout", gateWait, ["g1", "--timeout", "soon"]);
    await run("gate-park-no-id", gatePark, []);
    await run("gate-close-no-reason", gateClose, ["g1"]);
    await run("gate-close-bad-reason", gateClose, ["g1", "--reason", "bored"]);
    await run("gate-subscribe-no-flags", gateSubscribe, []);
    await run("gate-unsubscribe-no-id", gateUnsubscribe, []);
    await run("gate-list-bad-limit", gateList, ["--limit", "many"]);
    await run("gate-ask-no-questions", gateAsk, []);
    await run("gate-ask-bad-json", gateAsk, ["--questions", "{nope"]);
    await run("gate-answer-no-id", gateAnswer, []);
    await run("events-emit-no-topic", eventsEmit, []);
    await run("events-emit-bad-json", eventsEmit, ["t.x", "--json", "{nope"]);
    await run("events-wait-no-pattern", eventsWait, []);
    await run("events-wait-bad-after", eventsWait, ["t.*", "--after", "x"]);
    await run("events-list-bad-limit", eventsList, ["--limit", "x"]);
    await run("events-tail-bad-after", eventsTail, ["--after", "x"]);
    await run("gate-wait-retry-then-answered", async () => {
      let calls = 0;
      const wait = async () => (calls++ === 0 ? { ok: false, error: "socket closed" } : { ok: true, data: { status: "answered", row: { id: "g1" } } });
      await waitForGate("g1", null, wait as never, async () => {});
    }, []);
    await run("ci-claim-no-url", ciLeaseClaim, []);
    await run("ci-claim-no-url-json", ciLeaseClaim, ["--json"]);
    await run("ci-claim-bad-holder", ciLeaseClaim, ["https://gitlab.example.com/a/b/-/merge_requests/1", "--holder", "me"]);
    await run("ci-heartbeat-no-lease", ciLeaseHeartbeat, ["https://gitlab.example.com/a/b/-/merge_requests/1", "--holder", "doctor"]);
    await run("ci-release-no-lease", ciLeaseRelease, ["https://gitlab.example.com/a/b/-/merge_requests/1", "--holder", "doctor"]);
    await run("ci-show-none", ciLeaseShow, ["https://gitlab.example.com/a/b/-/merge_requests/1"]);
    await run("ci-show-none-json", ciLeaseShow, ["https://gitlab.example.com/a/b/-/merge_requests/1", "--json"]);
    await run("runs-find-no-session", runsFind, []);
    await run("runs-find-none", runsFind, ["--session", "s-none"]);
    await run("runs-run-start-no-args", runsRunStart, []);
    await run("runs-stage-start-no-args", runsStageStart, []);

    if (process.env.RT_UPDATE_AGENT_BYTES) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      const ascii = JSON.stringify(got, null, 2).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      writeFileSync(FIXTURE, ascii + "\n");
    }
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  }, 60_000);

  test("mcp tools lists every tool name, one per line, from the roster itself", async () => {
    const r = await runVerb(mcpToolsList, []);
    expect(r).toEqual({ code: 0, stdout: mcpToolsPayload().tools.map((t) => `${t.name}\n`).join(""), stderr: "" });
  });
});
```

The names imported above are the exports at `658e704b9` (`grep -n "^export async function" commands/gate.ts commands/events.ts commands/ci.ts commands/runs-write.ts`). `waitForGate(id, deadline, wait, sleep, sessionId?)` is exported for tests; the `gate-wait-retry-then-answered` entry drives it with a `wait` that fails once and a no-op sleep, which is the only way to reach the dead-daemon line without a daemon. The MCP roster is not frozen in the fixture (it grows with every tool); its plain path is checked against `mcpToolsPayload()` instead. The CI lease store reads `MATTSTACK_ATTENDANTS_DIR` (`packages/rt-client/src/ci-lease.ts`, as `commands/__tests__/ci.test.ts` sets it), and `CLAUDE_CODE_SESSION_ID` names the lease owner, so both are fixed above. If main has renamed one, use main's name and note it in the ledger.

- [ ] **Step 2: Capture from the unconverted code, and read it**

Run: `RT_UPDATE_AGENT_BYTES=1 bun test commands/__tests__/agent-verbs-bytes.test.ts`
Expected: PASS; the fixture exists with 28 entries.

Read the fixture before trusting it:

- `gate-wait-no-id`: code 1, stdout empty, stderr `rt gate: usage: rt gate wait <id> [--timeout <duration>]` and a newline.
- `gate-ask-no-questions`: code 1, stdout one JSON line `{"ok":false,"error":"usage: rt gate ask ..."}`, stderr empty.
- `events-emit-no-topic`: code 1, stderr starting `rt events: usage:`.
- `gate-wait-retry-then-answered`: code 0, stdout empty, stderr `rt gate: wait failed (socket closed); retrying until reconnect...` and a newline, once.
- `ci-claim-no-url`: code 2, stderr the usage line; `ci-claim-no-url-json`: code 2, stdout `{"error":"usage: rt ci lease claim <mr-url>"}`.
- `runs-find-no-session`: code 2, stdout one JSON line with `"ok":false`.
- No entry holds a path under the temp HOME (they read `<home>`) or a timestamp. If one does, extend `stable` for it and capture again. Do not hand-edit the fixture.

Run twice more without the variable: `bun test commands/__tests__/agent-verbs-bytes.test.ts`
Expected: PASS both times.

- [ ] **Step 3: Commit**

```bash
git add commands/__tests__/agent-verbs-bytes.test.ts commands/__tests__/fixtures/agent-verbs-bytes.json
```

```bash
git commit -m "agent verbs: pin every byte they write before the output layer touches them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The permanent exemption list

**Files:**
- Create: `lib/__tests__/raw-output-exemptions.json`
- Modify: `lib/__tests__/no-raw-output.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `lib/cli-logger.ts`, `lib/daemon-logger.ts`, `lib/daemon/inject.ts`)

**Interfaces:**
- Consumes: the guard's `RAW` patterns.
- Produces: the file format every later slice uses: `Array<{ file: string; reason: string; lines: number }>`, sorted by `file`.

- [ ] **Step 1: Count today's raw lines in the three seams**

Run: `bun -e 'import { readFileSync } from "fs"; const RAW=[/\bconsole\.(log|error|warn|info)\s*\(/, /\bprocess\.std(out|err)\b(?!\.(isTTY|columns|rows|fd|on|once|off|removeListener)\b)/, /from\s+["'"'"'][^"'"'"']*\/(ansi|tui|tui\/palette)\.ts["'"'"']/, /\\x1b\[|\\u001b\[/]; for (const f of ["lib/cli-logger.ts","lib/daemon-logger.ts","lib/daemon/inject.ts"]) console.log(f, readFileSync(f,"utf8").split("\n").filter(l=>RAW.some(r=>r.test(l))).length);'`
Expected: `lib/cli-logger.ts 1`, `lib/daemon-logger.ts 6`, `lib/daemon/inject.ts 1`. The count is of matching lines, comments included: two of `lib/daemon-logger.ts`'s six are comments that name `process.stderr.write` (`:334`, `:379`), so editing those comments moves the count too. If a count differs, use the number printed in Step 2's JSON and note it in the ledger.

- [ ] **Step 2: Create the exemptions file**

Create `lib/__tests__/raw-output-exemptions.json`:

```json
[
  {
    "file": "lib/cli-logger.ts",
    "reason": "The crash handler's last-resort print before exit; lib/ui/out.ts imports this module, so it cannot import out.",
    "lines": 1
  },
  {
    "file": "lib/daemon-logger.ts",
    "reason": "The daemon's own stderr capture: it replaces process.stderr.write so stray writes land in the daemon log, and reports its own init failure where no logger exists yet.",
    "lines": 6
  },
  {
    "file": "lib/daemon/inject.ts",
    "reason": "Parses escape sequences in a captured pane to read the text under them; it prints nothing.",
    "lines": 1
  }
]
```

- [ ] **Step 3: Write the failing tests**

Replace `lib/__tests__/no-raw-output.test.ts` with:

```ts
import { test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { relative, resolve } from "path";

// Human output goes through lib/ui/out.ts. The allowlist holds the files that
// still print by hand; it only ever shrinks, and it is empty when the
// conversion is done. The exemptions are the seams that must touch a stream
// directly, each with its reason and the exact number of raw lines it holds.
const ROOT = resolve(import.meta.dir, "..", "..");
const ALLOWLIST = resolve(import.meta.dir, "raw-output-allowlist.json");
const EXEMPTIONS = resolve(import.meta.dir, "raw-output-exemptions.json");
const SCAN_ROOTS = ["cli.ts", "commands", "lib"];

// The output layer itself, and the color modules it retires last.
const EXEMPT_DIRS = [/^lib\/ui\//, /^lib\/tui\//, /^lib\/ansi\.ts$/, /^lib\/tui\.ts$/];

const RAW = [/\bconsole\.(log|error|warn|info)\s*\(/, /\bprocess\.std(out|err)\b(?!\.(isTTY|columns|rows|fd|on|once|off|removeListener)\b)/, /from\s+["'][^"']*\/(ansi|tui|tui\/palette)\.ts["']/, /\\x1b\[|\\u001b\[/];

interface Exemption {
  file: string;
  reason: string;
  lines: number;
}

function collect(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    if (entry.name === "node_modules" || entry.name === "__tests__") return [];
    if (entry.isDirectory()) return collect(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function rawLines(file: string): number {
  return readFileSync(resolve(ROOT, file), "utf8")
    .split("\n")
    .filter((line) => RAW.some((re) => re.test(line))).length;
}

const exemptions = JSON.parse(readFileSync(EXEMPTIONS, "utf8")) as Exemption[];
const exempt = new Set(exemptions.map((e) => e.file));

function scanned(): string[] {
  return SCAN_ROOTS.flatMap((root) => collect(resolve(ROOT, root)))
    .map((file) => relative(ROOT, file))
    .filter((file) => !EXEMPT_DIRS.some((re) => re.test(file)))
    .sort();
}

function offenders(): string[] {
  return scanned().filter((file) => !exempt.has(file) && rawLines(file) > 0);
}

if (process.env.RT_UPDATE_RAW_OUTPUT_ALLOWLIST) {
  writeFileSync(ALLOWLIST, JSON.stringify(offenders(), null, 2) + "\n");
}

const allowed = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as string[];

test("no file outside the allowlist prints raw: use lib/ui/out.ts", () => {
  const known = new Set(allowed);
  expect(offenders().filter((file) => !known.has(file))).toEqual([]);
});

test("the allowlist names only files that still print raw: delete the line when a file is converted", () => {
  const current = new Set(offenders());
  expect(allowed.filter((file) => !current.has(file))).toEqual([]);
});

test("the allowlist is sorted and has no duplicates", () => {
  expect(allowed).toEqual([...new Set(allowed)].sort());
});

test("an exempt file holds exactly the raw lines its entry allows", () => {
  const drift = exemptions.filter((e) => rawLines(e.file) !== e.lines).map((e) => `${e.file}: entry says ${e.lines}, file has ${rawLines(e.file)}`);
  expect(drift).toEqual([]);
});

test("an exempt file that no longer prints raw is removed from the exemptions", () => {
  expect(exemptions.filter((e) => rawLines(e.file) === 0).map((e) => e.file)).toEqual([]);
});

test("no file is both exempt and allowlisted, and every exemption gives a reason", () => {
  expect(allowed.filter((file) => exempt.has(file))).toEqual([]);
  expect(exemptions.filter((e) => e.reason.trim().length < 20).map((e) => e.file)).toEqual([]);
});

test("the exemptions are sorted by file and have no duplicates", () => {
  const files = exemptions.map((e) => e.file);
  expect(files).toEqual([...new Set(files)].sort());
});
```

- [ ] **Step 4: Run it to verify the new list fails until the allowlist lines go**

Run: `bun test lib/__tests__/no-raw-output.test.ts`
Expected: FAIL on `no file is both exempt and allowlisted` (the three files are still on the allowlist) and on `the allowlist names only files that still print raw` (they are no longer offenders).

- [ ] **Step 5: Delete the three allowlist lines**

In `lib/__tests__/raw-output-allowlist.json`, delete `"lib/cli-logger.ts",`, `"lib/daemon-logger.ts",` and `"lib/daemon/inject.ts",`.

- [ ] **Step 6: Prove the count guard bites**

Temporarily add `console.log("x");` as the last line of `lib/daemon/inject.ts`.
Run: `bun test lib/__tests__/no-raw-output.test.ts -t "exactly the raw lines"`
Expected: FAIL naming `lib/daemon/inject.ts: entry says 1, file has 2`.
Remove the line. Run: `git diff --stat lib/daemon/inject.ts`
Expected: no output.

- [ ] **Step 7: Run the guard**

Run: `bun test lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/__tests__/raw-output-exemptions.json lib/__tests__/no-raw-output.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "guard: a permanent exemption list with reasons and pinned line counts; the three logging and parsing seams move onto it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `gate`, `events`, `mcp`, `ci`, `runs find` and the run-tracking writes, mechanically

Every edit is a rewrite with the same bytes. The rule, applied at every site in the six files:

| Today | Becomes | Why it is the same bytes |
|---|---|---|
| `console.log(JSON.stringify(x))` | `out.json(x)` | `out.json` writes `JSON.stringify(x, null, undefined) + "\n"` |
| `console.log(JSON.stringify(x, null, 2))` | `out.json(x, 2)` | same, with the indent |
| `console.log(text)` (text a program reads) | `out.payload(\`${text}\n\`)` | `console.log` adds one newline |
| `console.error(text)` | `out.diagnostic(\`${text}\n\`)` | the same |
| `process.stdout.write(s)` | `out.payload(s)` | identical call |
| `process.stderr.write(s)` | `out.diagnostic(s)` | identical call |

**Files:**
- Modify: `commands/gate.ts` (18 sites), `commands/events.ts` (7), `commands/mcp.ts` (2), `commands/ci.ts` (3), `commands/runs-find.ts` (1), `commands/runs-write.ts` (1)
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete those six lines)

**Interfaces:**
- Consumes: `out.json`, `out.payload` (phase 1), `out.diagnostic`, `out.jsonFlushed` (Task 2); Task 3's fixture test.
- Produces: no new names.

- [ ] **Step 1: `commands/gate.ts`**

Add `import * as out from "../lib/ui/out.ts";` after the last import. Then:

```ts
function fail(msg: string): never {
  out.diagnostic(`rt gate: ${msg}\n`);
  process.exit(1);
}
```

and, at the sites listed by `grep -n "console\." commands/gate.ts` (lines 118, 164, 165, 179, 227, 230, 232, 304, 352, 383, 387, 427, 437, 450, 461, 469, 484):

```ts
// 118
out.json({ ok: true, id: data.id, supersededId: data.supersededId });
// 164
if (data.conflict) out.diagnostic(`rt gate: answer lost: ${payload.id} was already answered; showing the winning row\n`);
// 165
out.json({ ok: true, row: data.row, conflict: data.conflict ?? false });
// 179 (askFail)
out.json({ ok: false, error: message });
// 227
out.diagnostic(`rt gate: context omitted: gate context plus question contexts exceeded the shared ${CONTEXT_CAP_BYTES}-byte budget; question contexts were dropped, and the gate context too if it was over on its own; shorten and re-ask\n`);
// 230
out.diagnostic(`rt gate: form cap exceeded (${data.formCapExceeded.map((q) => `${q.question}: ${q.options}`).join(", ")}): ${data.formCapAdvisory}\n`);
// 232
out.json(gateAskOutput(data));
// 304
out.json(forkCheckHookOutput(res));
// 352
out.diagnostic(`rt gate: wait failed (${res.error ?? "unknown error"}); retrying until reconnect...\n`);
// 383
out.json({ ok: true, timedOut: true });
// 387
out.json({ ok: true, status: outcome.terminal, row: outcome.row });
// 427
out.json({ ok: true, gates: withGateTokens(data.gates), cursor: data.cursor });
// 437 and 450
out.json({ ok: true });
// 461
out.json({ ok: true, id: data.id });
// 469
out.json({ ok: true, removed: data.removed });
// 484
out.json({ ok: true, subscriptions: data.subscriptions });
```

(The `// <line>` markers are this plan's labels and are not copied into the source.) The text of line 227 holds three dots where today's source holds three dots; read the source line before editing and keep its characters exactly.

- [ ] **Step 2: `commands/events.ts`**

Add the `out` import. `fail` becomes `out.diagnostic(\`rt events: ${msg}\n\`); process.exit(1);`. Lines 64, 91, 97, 117 become `out.json(<the same object>)`. Lines 134 and 140, `console.log(JSON.stringify(ev))` inside a loop, become `out.json(ev)`. The `fail` messages that hold a long dash today (`daemon unavailable ... (rt daemon start)`) are not reworded: this verb's stderr is frozen.

- [ ] **Step 3: `commands/mcp.ts`**

Add the `out` import. Replace the `--json` branch and the plain loop:

```ts
  if (args.includes("--json")) {
    await out.jsonFlushed(payload);
    return;
  }
  out.payload(payload.tools.map((t) => `${t.name}\n`).join(""));
```

Delete the comment above the branch that explains the awaited write; `jsonFlushed`'s own comment carries it.

- [ ] **Step 4: `commands/ci.ts`**

Add the `out` import. `emit` becomes:

```ts
function emit(json: boolean, body: unknown, text: string, code = 0): never {
  if (json) out.json(body);
  else if (code === 0) out.payload(`${text}\n`);
  else out.diagnostic(`${text}\n`);
  process.exit(code);
}
```

Keep its doc comment, but change "Mirrors commands/chat.ts's fail()" to nothing: delete that sentence (chat no longer works this way).

- [ ] **Step 5: `commands/runs-find.ts` and `commands/runs-write.ts`**

Add the `out` import to each. `if (r.out !== "") console.log(r.out);` becomes `if (r.out !== "") out.payload(\`${r.out}\n\`);` in `runsFind`, and the same with `result` in `finish`.

- [ ] **Step 6: Delete six allowlist lines**

Delete `commands/gate.ts`, `commands/events.ts`, `commands/mcp.ts`, `commands/ci.ts`, `commands/runs-find.ts`, `commands/runs-write.ts` from `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 7: Run the fixture, the unit tests and the guard**

Run: `bun test commands/__tests__/agent-verbs-bytes.test.ts commands/__tests__/gate.test.ts commands/__tests__/gate-ask-cli.test.ts commands/__tests__/gate-fork-check-cli.test.ts commands/__tests__/ci.test.ts commands/__tests__/no-ci-cli.test.ts commands/__tests__/runs-find.test.ts commands/__tests__/runs-write.test.ts commands/__tests__/runs.test.ts commands/__tests__/mcp-tools-list.test.ts commands/__tests__/no-mcp-tools-pipe.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS, with `commands/__tests__/fixtures/agent-verbs-bytes.json` untouched. `commands/__tests__/gate.test.ts:119` spies `console.error`: if it now fails because the message no longer reaches `console.error`, change that test to read the stderr buffer of a `captureOut()` instead, keeping its expected string.
Run: `grep -n "console\.\|process\.std\(out\|err\)\.write" commands/gate.ts commands/events.ts commands/mcp.ts commands/ci.ts commands/runs-find.ts commands/runs-write.ts`
Expected: no output.
Run: `bun run typecheck`
Expected: no errors.
Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/gate-answer.test.ts e2e/tests/gate-ask-cli.test.ts e2e/tests/gate-fork-check-cli.test.ts e2e/tests/events.test.ts e2e/tests/mcp-serve.test.ts e2e/tests/runs.test.ts`
Expected: PASS with no edit to any of them.

- [ ] **Step 8: Commit**

```bash
git add commands/gate.ts commands/events.ts commands/mcp.ts commands/ci.ts commands/runs-find.ts commands/runs-write.ts lib/__tests__/raw-output-allowlist.json commands/__tests__/gate.test.ts
```

```bash
git commit -m "agent verbs: gate, events, mcp, ci and runs write through out.json, out.payload and out.diagnostic with the same bytes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(If `gate.test.ts` was not edited, leave it out of `git add`.)

---

### Task 6: `rt worktree claude-hook` keeps its bytes; the hook verbs draw blocks

`claude-hook` is Claude Code's hook: mechanical. `hook install`, `uninstall` and `status` are run by a person (hidden verbs under `worktree`), so they draw blocks; their `--json` replies are untouched. The two warnings in `maybeOfferClaudeHook` are scoping rows 50 and 51.

**Files:**
- Modify: `commands/worktree-hook.ts`
- Modify: `commands/__tests__/worktree-hook.test.ts`
- Modify: `lib/__tests__/raw-output-allowlist.json` (delete `commands/worktree-hook.ts`)

**Interfaces:**
- Consumes: `out.*` builders, `out.diagnostic`, `warn` (`lib/ui/warn.ts`).
- Produces: `hookStatusBlocks(s: ClaudeHookStatus): Block[]` and `hookResultBlocks(kind: "install" | "uninstall", changed: boolean): Block[]`, both exported for the renders.

Copy table:

| Site | Today (plain) | At a terminal and off it, after |
|---|---|---|
| `hook install`, changed | `✓ hook installed (<rtBin>)` | `line("done", "Installed the worktree hook", "Claude Code now asks rt for a worktree")` |
| `hook install`, unchanged | `✓ already installed` | `line("skipped", "The worktree hook is already installed")` |
| `hook install`, rt not on PATH | `✗ rt is not on PATH; install rt first` (stdout, exit 1) | `out.fail({ title: "rt is not on your PATH", why: "The hook runs rt by name, so Claude Code has to find it." })`, exit 1 |
| `hook uninstall`, changed | `✓ hook entries removed` | `line("done", "Removed the worktree hook")` |
| `hook uninstall`, unchanged | `nothing to remove` | `line("skipped", "The worktree hook was not installed")` |
| `hook status`, not installed | `hook not installed (rt worktree hook install)` | `line("off", "The worktree hook is not installed")`, `callout("next", cmd("rt worktree hook install"))` |
| `hook status`, installed, binary ok | `installed: <command>` / `binary: ok` | `line("done", "The worktree hook is installed")`, `kv("runs", <command>)` |
| `hook status`, binary missing | `✗ binary missing (EnterWorktree will fail everywhere); escape hatch: rt worktree hook uninstall` | `out.fail({ title: "The worktree hook points at an rt that is gone", why: "Every new Claude worktree will fail until it is fixed." , next: out.cmd("rt worktree hook uninstall") })`, then exit 0 as today |
| a settings file error (`settingsFail`) | `✗ <err>` (stdout, exit 1) | `out.fail({ title: "rt could not update Claude Code's settings", why: <first line of err> })`, exit 1 |
| offer, rt not on PATH (row 50) | `rt: skipping claude hook install offer... rt is not on PATH` | `warn("worktree-hook", "skipping claude hook install offer: rt is not on PATH", { show: { title: "rt could not install the worktree hook", hint: "rt is not on your PATH" } })` |
| offer failed (row 51) | `rt: claude hook install offer failed... <err>` | `warn("worktree-hook", \`claude hook install offer failed: ${String(err)}\`, { show: { title: "rt could not install the worktree hook", hint: firstLine(String(err)), next: out.cmd("rt worktree hook install") } })` |

`--json` envelopes (`{ error }`, `{ installed, changed, rtBin }`, `{ installed: false, changed }`, the status object) are written by `out.json` with the same objects. `hook status --json`'s object is `skills/rt-worktree`'s reader and must not change: Task 3's fixture does not reach it (it reads the real settings path), so Step 1 pins it here.

`claude-hook`'s three sites keep their bytes: `console.error("rt worktree claude-hook: unrecognized stdin payload")` becomes `out.diagnostic("rt worktree claude-hook: unrecognized stdin payload\n")`; the two `console.error` refusals likewise; `console.log(decision.path)` becomes `out.payload(\`${decision.path}\n\`)`.

- [ ] **Step 0: Pin the hook verbs' `--json` replies first** (passes on today's code)

`skills/rt-worktree` reads `hook status --json`. `claudeSettingsPath()` follows `process.env.HOME`, and `worktree-hook.test.ts`'s `describe("hookInstallCommand")` already points HOME at a temp dir, so the replies can be pinned there. Add, inside that `describe` (import `hookStatusCommand` and `hookUninstallCommand` beside `hookInstallCommand`, `spyOn` from `bun:test`, and `captureOut` from `../../lib/ui/__tests__/capture-out.ts`):

```ts
  test("the hook verbs' --json replies, pinned before the output layer", async () => {
    const run = async (fn: () => Promise<void>): Promise<{ code: number; stdout: string }> => {
      const io = captureOut({ console: true });
      const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
        throw new Error(`exit ${c ?? 0}`);
      }) as unknown as typeof process.exit);
      let code = 0;
      try {
        await fn();
      } catch (err) {
        const m = /^exit (\d+)$/.exec((err as Error).message);
        if (!m) throw err;
        code = Number(m[1]);
      } finally {
        exit.mockRestore();
      }
      const stdout = io.stdout();
      io.restore();
      return { code, stdout };
    };
    expect(await run(() => hookStatusCommand(["--json"], undefined))).toEqual({ code: 0, stdout: '{"installed":false}\n' });
    expect(await run(() => hookInstallCommand(["--json"], undefined, { which: () => null }))).toEqual({ code: 1, stdout: '{"error":"rt-not-on-path"}\n' });
    expect(await run(() => hookInstallCommand(["--json"], undefined, { which: () => "/x/rt" }))).toEqual({ code: 0, stdout: '{"installed":true,"changed":true,"rtBin":"/x/rt"}\n' });
    expect(await run(() => hookStatusCommand(["--json"], undefined))).toEqual({ code: 0, stdout: '{"installed":true,"command":"/x/rt worktree claude-hook","binaryExists":false}\n' });
    expect(await run(() => hookUninstallCommand(["--json"], undefined))).toEqual({ code: 0, stdout: '{"installed":false,"changed":true}\n' });
  });
```

Run it on today's code: PASS. If a reply's key order differs, the expectation follows what today's code prints (read it from the failure) and the ledger notes it; Steps 3 and 5 must leave this test passing unchanged.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/worktree-hook.test.ts`, extend the import to `import { hookInstallCommand, hookRepoIdentity, hookResultBlocks, hookStatusBlocks, parseHookStdin, priorClaudeHookAnswer, recordClaudeHookAnswer, shouldOfferClaudeHook } from "../worktree-hook.ts";`, add `import { renderPlain } from "../../lib/ui/out-plain.ts";`, and append:

```ts
describe("the hook verbs a person runs", () => {
  test("status: not installed names the install command", () => {
    expect(renderPlain(hookStatusBlocks({ installed: false } as never))).toBe("[off] The worktree hook is not installed\n  next: rt worktree hook install\n");
  });

  test("status: installed shows what it runs", () => {
    expect(renderPlain(hookStatusBlocks({ installed: true, command: "/opt/rt/bin/rt worktree claude-hook", binaryExists: true } as never))).toBe(
      "[ok] The worktree hook is installed\nruns: /opt/rt/bin/rt worktree claude-hook\n",
    );
  });

  test("install and uninstall say what changed, or that nothing did", () => {
    expect(renderPlain(hookResultBlocks("install", true))).toBe("[ok] Installed the worktree hook  Claude Code now asks rt for a worktree\n");
    expect(renderPlain(hookResultBlocks("install", false))).toBe("[skipped] The worktree hook is already installed\n");
    expect(renderPlain(hookResultBlocks("uninstall", true))).toBe("[ok] Removed the worktree hook\n");
    expect(renderPlain(hookResultBlocks("uninstall", false))).toBe("[skipped] The worktree hook was not installed\n");
  });
});
```

Then, inside the existing `describe("hookInstallCommand")` (its temp HOME keeps the real `~/.claude/settings.json` out of reach; add `mkdirSync` and `writeFileSync` to the `fs` import if missing):

```ts
  test("the three hook failures read plainly on stderr", async () => {
    const io = captureOut();
    out.__test__.setHuman(() => false);
    const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c ?? 0}`);
    }) as unknown as typeof process.exit);
    try {
      await expect(hookInstallCommand([], undefined, { which: () => null })).rejects.toThrow("exit 1");
      expect(io.stderr()).toStartWith("rt is not on your PATH\n");
      expect(io.stdout()).toBe("");
      await hookInstallCommand([], undefined, { which: () => "/x/rt" });
      io.clear();
      await hookStatusCommand([], undefined);
      expect(io.stderr()).toStartWith("The worktree hook points at an rt that is gone\n");
      io.clear();
      writeFileSync(join(process.env.HOME!, ".claude", "settings.json"), "{");
      await expect(hookUninstallCommand([], undefined)).rejects.toThrow("exit 1");
      expect(io.stderr()).toStartWith("rt could not update Claude Code's settings\n");
      expect(io.stdout()).toBe("");
    } finally {
      exit.mockRestore();
      out.__test__.setHuman(undefined);
      io.restore();
    }
  });
```

(`import * as out from "../../lib/ui/out.ts";` joins the imports; Step 0 already added `captureOut`, `spyOn`, `hookStatusCommand` and `hookUninstallCommand`.)

The plain renderer writes a `kv` block as `key: value` (checked at `658e704b9`: `renderPlain([kv("runs", "y")])` is `runs: y`).

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/worktree-hook.test.ts -t "a person runs|three hook failures"`
Expected: FAIL: Bun reports `SyntaxError: Export named 'hookResultBlocks' not found in module` when the file loads (a missing named export fails at link time, so every test in the file stops until Step 3).

- [ ] **Step 3: Implement**

In `commands/worktree-hook.ts`, add:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { warn } from "../lib/ui/warn.ts";
```

Replace `emit` and `settingsFail`, and add the two builders:

```ts
function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}

export function hookResultBlocks(kind: "install" | "uninstall", changed: boolean): Block[] {
  if (kind === "install") {
    return [changed ? out.line("done", "Installed the worktree hook", "Claude Code now asks rt for a worktree") : out.line("skipped", "The worktree hook is already installed")];
  }
  return [changed ? out.line("done", "Removed the worktree hook") : out.line("skipped", "The worktree hook was not installed")];
}

export function hookStatusBlocks(s: ReturnType<typeof claudeWorktreeHookStatus>): Block[] {
  if (!s.installed) return [out.line("off", "The worktree hook is not installed"), out.callout("next", out.cmd("rt worktree hook install"))];
  return [out.line("done", "The worktree hook is installed"), out.kv("runs", s.command)];
}

function settingsFail(json: boolean, err: unknown): never {
  if (json) out.json({ error: String(err) });
  else out.fail({ title: "rt could not update Claude Code's settings", why: firstLine(String(err)) });
  process.exit(1);
}
```

`hookInstallCommand`:

```ts
  if (!rtBin) {
    if (json) out.json({ error: "rt-not-on-path" });
    else out.fail({ title: "rt is not on your PATH", why: "The hook runs rt by name, so Claude Code has to find it." });
    process.exit(1);
  }
  try {
    const r = installClaudeWorktreeHooks(claudeSettingsPath(), rtBin);
    recordClaudeHookAnswer("installed");
    if (json) out.json({ installed: true, changed: r.changed, rtBin });
    else out.print(...hookResultBlocks("install", r.changed));
  } catch (err) {
    settingsFail(json, err);
  }
```

`hookUninstallCommand`'s try body:

```ts
    const r = uninstallClaudeWorktreeHooks(claudeSettingsPath());
    if (json) out.json({ installed: false, changed: r.changed });
    else out.print(...hookResultBlocks("uninstall", r.changed));
```

`hookStatusCommand`'s try body:

```ts
    const s = claudeWorktreeHookStatus(claudeSettingsPath());
    if (json) {
      out.json(s);
      return;
    }
    if (s.installed && !s.binaryExists) {
      out.fail({ title: "The worktree hook points at an rt that is gone", why: "Every new Claude worktree will fail until it is fixed.", next: out.cmd("rt worktree hook uninstall") });
      return;
    }
    out.print(...hookStatusBlocks(s));
```

`maybeOfferClaudeHook`'s two warnings:

```ts
    if (!rtBin) {
      warn("worktree-hook", "skipping claude hook install offer: rt is not on PATH", { show: { title: "rt could not install the worktree hook", hint: "rt is not on your PATH" } });
      return;
    }
```

```ts
  } catch (err) {
    warn("worktree-hook", `claude hook install offer failed: ${String(err)}`, {
      show: { title: "rt could not install the worktree hook", hint: firstLine(String(err)), next: out.cmd("rt worktree hook install") },
    });
  }
```

`claudeHookCommand`: the three byte-for-byte rewrites in the copy table's last paragraph.

The `--json` path of the old `emit` printed the object; every branch above prints the same object through `out.json`. The removed `emit` helper had no other caller (`grep -n "emit(" commands/worktree-hook.ts` must print nothing after the edit).

- [ ] **Step 4: Pin `claude-hook`'s stdout**

Append to `commands/__tests__/worktree-hook.test.ts`:

```ts
test("a refusal leaves stdout empty and exits 2", async () => {
  const stdin = spyOn(Bun.stdin, "text").mockResolvedValue("{}");
  const io = captureOut();
  out.__test__.setHuman(() => false);
  const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as unknown as typeof process.exit);
  try {
    await expect(claudeHookCommand([], undefined)).rejects.toThrow("exit 2");
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toBe("rt worktree claude-hook: unrecognized stdin payload\n");
  } finally {
    exit.mockRestore();
    stdin.mockRestore();
    io.restore();
  }
});
```

(Add `claudeHookCommand` to the import from `../worktree-hook.ts`, `spyOn` to the `bun:test` import, and `import * as out from "../../lib/ui/out.ts";` and `import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";`.) The path-printing branch needs the daemon, so the second guarantee is checked in the source, where it cannot drift without this test seeing it:

```ts
test("claude-hook writes only the path on stdout", () => {
  const src = readFileSync(join(import.meta.dir, "..", "worktree-hook.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function claudeHookCommand"));
  expect(body.match(/out\.(payload|json|print)\(/g)).toEqual(["out.payload("]);
});
```

(Add `readFileSync` and `join` to the test file's imports if they are not there.)

- [ ] **Step 5: Delete the allowlist line and run**

Delete `"commands/worktree-hook.ts",` from the allowlist.
Run: `bun test commands/__tests__/worktree-hook.test.ts commands/__tests__/agent-verbs-bytes.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.
Run: `grep -n "console\.\|process\.std\(out\|err\)\.write" commands/worktree-hook.ts`
Expected: no output.
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add commands/worktree-hook.ts commands/__tests__/worktree-hook.test.ts lib/__tests__/raw-output-allowlist.json
```

```bash
git commit -m "worktree hook: claude-hook keeps its bytes; install, uninstall and status draw blocks; the offer's warnings go through warn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The allowlist and the readers, checked

No code.

- [ ] **Step 1: The allowlist lost exactly ten lines**

Run: `git diff origin/main -- lib/__tests__/raw-output-allowlist.json`
Expected: ten deleted lines (`commands/ci.ts`, `events.ts`, `gate.ts`, `mcp.ts`, `runs-find.ts`, `runs-write.ts`, `worktree-hook.ts`, `lib/cli-logger.ts`, `lib/daemon-logger.ts`, `lib/daemon/inject.ts`) and nothing added.

- [ ] **Step 2: No reader quotes text this slice changed**

Run: `rg -n "hook installed|already installed|hook entries removed|nothing to remove|hook not installed|binary missing|skipping claude hook" skills plugins/mattstack apps/board/skills marketplace e2e`
Expected: no output, or only lines that read `--json`. A hit that reads the old plain text is fixed in this PR: update it to read `--json`, or to the new words, and say so in the report.

---

### Task 8: Renders, AGENTS.md and every gate

**Files:**
- Modify: `AGENTS.md` ("Output layer": append)
- Modify: `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/6a-hook-dark.png`, `6a-hook-light.png`

- [ ] **Step 1: Render input**

Run: `bun run ui:build`

In the scratchpad (not the repo), write `blocks-6a.ts` (replace `<repo>` with the worktree's absolute path):

```ts
import { hookResultBlocks, hookStatusBlocks } from "<repo>/commands/worktree-hook.ts";
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine } from "<repo>/lib/ui/protocol.ts";

const blocks = [
  ...hookResultBlocks("install", true),
  ...hookResultBlocks("install", false),
  ...hookResultBlocks("uninstall", false),
  ...hookStatusBlocks({ installed: false } as never),
  ...hookStatusBlocks({ installed: true, command: "/opt/rt/bin/rt worktree claude-hook", binaryExists: true } as never),
  out.failure({ title: "The worktree hook points at an rt that is gone", why: "Every new Claude worktree will fail until it is fixed.", next: out.cmd("rt worktree hook uninstall") }),
  out.failure({ title: "rt is not on your PATH", why: "The hook runs rt by name, so Claude Code has to find it." }),
  out.line("warn", "rt could not install the worktree hook", "rt is not on your PATH"),
  out.line("warn", "rt could not install the worktree hook", "permission denied"),
  out.callout("next", out.cmd("rt worktree hook install")),
];
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + blocks.map(encodeLine).join(""));
```

Copy `ansi-page.ts` from 5f2's plan (Task 7 Step 1) into the scratchpad unchanged.

- [ ] **Step 2: Render both schemes**

Run each alone from the scratchpad:

```bash
bun blocks-6a.ts > 6a.ndjson
COLORTERM=truecolor TERM=xterm-256color RT_UI_BACKGROUND=dark <repo>/ui/dist/rt-ui render --width 100 < 6a.ndjson > 6a-dark.ansi
COLORTERM=truecolor TERM=xterm-256color RT_UI_BACKGROUND=light <repo>/ui/dist/rt-ui render --width 100 < 6a.ndjson > 6a-light.ansi
bun ansi-page.ts dark 6a < 6a-dark.ansi > 6a-dark.html
bun ansi-page.ts light 6a < 6a-light.ansi > 6a-light.html
```

- [ ] **Step 3: Screenshot both and look**

Serve the scratchpad on 127.0.0.1 (`python3 -m http.server 4173 --bind 127.0.0.1`), screenshot both pages with Fast Browser, and save them as `docs/design/output-layer/6a-hook-dark.png` and `6a-hook-light.png`. Read each PNG and write down plainly what reads wrong, checking: the `off` status line reads as a state, not an error; the missing-binary failure is coral and the two warnings are not; the `runs` value is not clipped at 100 columns; body text is the terminal's own color on both. A fault is fixed in Task 6's code, re-rendered, and named in the report.

- [ ] **Step 4: README row**

Append to the table in `docs/design/output-layer/README.md`:

```markdown
| `6a-hook-dark.png`, `6a-hook-light.png` | `rt worktree hook install`, `uninstall` and `status` at 100 columns, the missing-binary and not-on-PATH failures, and the two hook-offer warnings. The agent-only verbs (`gate`, `events`, `ci`, `runs`, `mcp`, `claude-hook`) print exactly what they printed before |
```

- [ ] **Step 5: AGENTS.md**

At the end of the "Output layer" section, append (wrapped at about 78 columns):

```markdown
The agent-only verbs the spec leaves unconverted (`gate`, `events`, `ci`,
`mcp`, `runs find` and the run-tracking writes, `worktree claude-hook`)
still write through the layer, with no change of bytes: stdout through
`out.json`, `out.jsonFlushed` or `out.payload`, stderr through
`out.diagnostic`, which is the stderr twin of `out.payload` and is for
agent-facing verbs only (these, and the herd, pane and agent verbs).
`commands/__tests__/fixtures/agent-verbs-bytes.json` pins them; never
regenerate it to make a change pass. A file that must
touch a stream directly (the loggers, an escape parser) goes on
`lib/__tests__/raw-output-exemptions.json` with its reason and its exact
count of raw lines, and the guard fails if that count moves.
```

- [ ] **Step 6: Every gate**

Run each from the repo root, one at a time: `bun run ui:build`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`.
Expected: all pass. Known noise (herd notes): about ten rotating load flakes in the unit suite and the `rt plugin new` e2e on this machine. A failure in a file this slice did not touch that passes alone is a flake; report both results.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/6a-hook-dark.png docs/design/output-layer/6a-hook-light.png
```

```bash
git commit -m "docs: the agent-only verbs' frozen bytes and the exemption list, with hook renders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Ship

**Files:** none beyond what a rebase touches.

- [ ] **Step 1: Rebase**

Run: `git fetch origin`
Run: `git rebase origin/main`
Merge by hand (cross-phase ruling 7): the allowlist keeps every deletion from both sides; `AGENTS.md` and the README keep others' additions, then this slice's; `lib/ui/out.ts` keeps any export another slice appended (6f's `holdStdout`), then this slice's two.

- [ ] **Step 2: Gates again**

Run the eight gates of Task 8 Step 6, one at a time. Expected: all pass; the fixture passes as committed.

- [ ] **Step 3: Measure**

Run: `git diff --shortstat origin/main...HEAD`
Expected: about 1,300 changed lines. Put the number in the report.

- [ ] **Step 4: Push and open the PR**

Push with the `git_push` MCP tool. Write the body to `<scratchpad>/pr-body-6a.md` and run:

`gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6a, agent-only" --body-file <scratchpad>/pr-body-6a.md`

The body: one framing paragraph; **Agent-only verbs** (same bytes on both streams, pinned by a fixture captured first; `out.diagnostic` and `out.jsonFlushed`); **Hook verbs** (blocks, `--json` unchanged); **Guard** (the exemption list, three seams, pinned counts); the two renders; a verification line with the gate results; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Report**

The PR URL, gate results with any flake and both of its results, the measured size, and what the renders showed. Do not merge.

---

## Decisions this plan made

1. **Agent-only stderr keeps its bytes, through a new `out.diagnostic`.** The spec's non-goal says these verbs move with "no wording involved"; dropping the `rt gate:` prefix (as `out.fail` would) changes what eight skills' agents read. `out.diagnostic` is restricted by AGENTS.md to these verbs.
2. **The hook verbs a person runs are converted.** They are hidden but human; their plain text off a terminal takes the new wording (spec "Plain output off a TTY"); `--json` is unchanged and is what `skills/rt-worktree` reads.
3. **Exemptions pin an exact line count,** not a ceiling, so a removed raw line forces the entry down too and the list never carries slack.
4. **`jsonFlushed` resolves at once under a one-argument test double** of `process.stdout.write`, which is how `captureOut` stubs it; the real stream resolves on the write callback.

## Self-Review

**Spec coverage.** "Guard": the two ways a non-printing offender leaves (Task 5 mechanical, Task 4 exemption with a reason). "Non-goals": agent-only verbs not reworded (Tasks 3, 5, 6). Rules 1 and 3 for the hook verbs (Task 6). Scoping shared items 1, 2, 8 (Tasks 4, 2, 3), warnings rows 50 and 51 (Task 6). Ten allowlist lines (Tasks 4 to 6, checked in Task 7).

**Placeholders.** None. `<repo>` and `<scratchpad>` are the implementer's own paths. Task 3 names the one lookup the implementer does (the lease directory variable) and what to do with a difference.

**Type consistency.** `jsonFlushed(value, indent?)`, `diagnostic(text)`, `hookResultBlocks(kind, changed)`, `hookStatusBlocks(s)`, the `Exemption` shape, and `runVerb` are spelled the same everywhere they appear.

**Review Focus.** Five lines, each pinned by a named test.
