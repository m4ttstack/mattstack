# Console Run Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mattstack run registers its Claude session as an rt agent, and console's run detail can resume a held run whose pane is gone.

**Architecture:** A new daemon verb `agent:adopt` turns a Claude session into an agent record by finding its transcript (launch folder and account) without launching anything. Run writes adopt the run's session on `run-start` and `stage-start` and record the agent id as the run field `agent`. Console gets a `POST /api/runs/:repo/:runId/resume` route (adopt if needed, then `agent:resume` with a re-entry prompt) and a Resume button beside the existing Focus pane button.

**Tech Stack:** Bun + TypeScript (rt, daemon, `bun:test`), `bun:sqlite`, `@mattstack/rt-client`, Hono, React + `@mattstack/app-kit` (Mantine), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-08-console-run-resume-design.md`

## Global Constraints

- Run every rt `bun test` from the worktree root (`bunfig.toml` preload; a run from a subdirectory keeps the real HOME).
- No `console.log`/`console.warn`/`process.stdout`/`process.stderr` writes under `lib/` or `commands/` (`lib/__tests__/no-raw-output.test.ts`).
- Run-side adoption is best effort on `emitRunUpdated`'s contract: `RT_RUN_EMIT=0` skips it, every failure is swallowed, and a write verb's stdout bytes never change.
- `agent:adopt` is not an MCP tool and not `agentSafe`; no change under `lib/mcp/` or `lib/command-tree-def.ts`.
- Session ids must match `^[A-Za-z0-9-]+$` before any path join.
- Console never writes a run DB.
- After touching `packages/rt-client/src`, run `bun run build` in `packages/rt-client` (stale `dist/` breaks console and the freshness test).
- Console tests run through `bun run console:test`; console typecheck and lint through `bun run console:typecheck` and `bun run console:lint`.
- UI copy: plain sentences, no em or en dashes.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Mattstack repo: run only targeted tests locally; CI runs the full suite.

## Review Focus

1. A transcript whose first lines carry no `cwd` (a summary or snapshot line first): the locator must skip to the first line that has one, not give up. Pinned in Task 1.
2. A session id carrying `/` or `..` from a caller: refused before any filesystem read. Pinned in Task 1 and Task 2.
3. The daemon is down while a pipeline starts a stage: the stage write returns its usual bytes and exit code, and the next `stage-start` registers the session. Pinned in Task 3.
4. A user presses Resume twice: the second press adopts nothing new (idempotent) and the server refuses once a live agent appears. Pinned in Task 2 (idempotence) and Task 4 (409 on a live agent).
5. A run that finished, or never recorded a session, shows no Resume button and the route refuses it. Pinned in Task 4 and Task 5.

---

### Task 1: Transcript locator

Finds `<sessionId>.jsonl` under `~/.claude` and each cswap account dir, picks the copy and account to resume under, and reads the launch folder from the first `cwd` in the transcript.

**Files:**
- Create: `lib/agent-adopt.ts`
- Modify: `lib/cswap.ts` (add `cswapAccountNumbers`)
- Test: `lib/__tests__/agent-adopt.test.ts`

**Interfaces:**
- Produces:
  - `export interface TranscriptHit { path: string; cwd: string; account?: string }`
  - `export interface TranscriptDeps { home: string; cswapAccounts(): Promise<{ number: number; email: string }[]> }`
  - `export function firstCwd(path: string): string | null`
  - `export async function locateTranscript(sessionId: string, preferredAccount: string | undefined, deps: TranscriptDeps): Promise<TranscriptHit | null>`
  - `export async function cswapAccountNumbers(exec?: typeof runCapture): Promise<{ number: number; email: string }[]>` in `lib/cswap.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/__tests__/agent-adopt.test.ts
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { firstCwd, locateTranscript, type TranscriptDeps } from "../agent-adopt.ts";

const SID = "3b9e2f1a-0c4d-4e8f-9a7b-1c2d3e4f5a6b";

function transcript(configDir: string, project: string, lines: object[], mtimeSec?: number): string {
  const dir = join(configDir, "projects", project);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${SID}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (mtimeSec !== undefined) utimesSync(path, mtimeSec, mtimeSec);
  return path;
}

function home(): string {
  return mkdtempSync(join(tmpdir(), "rt-adopt-"));
}

function deps(h: string, accounts: { number: number; email: string }[] = []): TranscriptDeps {
  return { home: h, cswapAccounts: async () => accounts };
}

const LINES = [
  { type: "summary", summary: "x" },
  { type: "user", cwd: "/Users/me/src/app" },
  { type: "user", cwd: "/Users/me/worktrees/ron" },
];

describe("firstCwd", () => {
  test("skips lines without a cwd and returns the first absolute one", () => {
    const h = home();
    const path = transcript(join(h, ".claude"), "-Users-me-src-app", LINES);
    expect(firstCwd(path)).toBe("/Users/me/src/app");
  });

  test("null when no line carries a cwd", () => {
    const h = home();
    const path = transcript(join(h, ".claude"), "p", [{ type: "summary" }]);
    expect(firstCwd(path)).toBeNull();
  });
});

describe("locateTranscript", () => {
  test("~/.claude copy resolves with no account", async () => {
    const h = home();
    transcript(join(h, ".claude"), "-Users-me-src-app", LINES);
    const hit = await locateTranscript(SID, undefined, deps(h));
    expect(hit).toMatchObject({ cwd: "/Users/me/src/app" });
    expect(hit?.account).toBeUndefined();
  });

  test("a cswap-only copy resolves to that dir's account email", async () => {
    const h = home();
    transcript(join(h, ".claude-swap-backup", "sessions", "2-me_example.com"), "p", LINES);
    const hit = await locateTranscript(SID, undefined, deps(h, [{ number: 2, email: "me@example.com" }]));
    expect(hit).toMatchObject({ cwd: "/Users/me/src/app", account: "me@example.com" });
  });

  test("the preferred account wins when its dir holds a copy", async () => {
    const h = home();
    transcript(join(h, ".claude"), "p", LINES);
    transcript(join(h, ".claude-swap-backup", "sessions", "1-work_example.com"), "p", LINES);
    const hit = await locateTranscript(SID, "work@example.com", deps(h, [{ number: 1, email: "work@example.com" }]));
    expect(hit?.account).toBe("work@example.com");
  });

  test("among cswap copies the newest wins", async () => {
    const h = home();
    const root = join(h, ".claude-swap-backup", "sessions");
    transcript(join(root, "1-a_example.com"), "p", LINES, 1_000);
    transcript(join(root, "2-b_example.com"), "p", LINES, 2_000);
    const hit = await locateTranscript(SID, undefined, deps(h, [
      { number: 1, email: "a@example.com" },
      { number: 2, email: "b@example.com" },
    ]));
    expect(hit?.account).toBe("b@example.com");
  });

  test("null when no dir holds the transcript", async () => {
    expect(await locateTranscript(SID, undefined, deps(home()))).toBeNull();
  });

  test("a session id with a path separator is refused before any read", async () => {
    const h = home();
    transcript(join(h, ".claude"), "p", LINES);
    expect(await locateTranscript(`../${SID}`, undefined, deps(h))).toBeNull();
    expect(await locateTranscript("a/b", undefined, deps(h))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/__tests__/agent-adopt.test.ts`
Expected: FAIL, `Cannot find module '../agent-adopt.ts'`.

- [ ] **Step 3: Write the locator**

```ts
// lib/agent-adopt.ts
import { closeSync, openSync, readdirSync, readSync, statSync } from "fs";
import { join } from "path";

export interface TranscriptHit { path: string; cwd: string; account?: string }

export interface TranscriptDeps {
  home: string;
  cswapAccounts(): Promise<{ number: number; email: string }[]>;
}

const SESSION_ID = /^[A-Za-z0-9-]+$/;
// The first cwd sits within the opening lines; a transcript can run to
// hundreds of megabytes, so only its head is read.
const HEAD_BYTES = 1024 * 1024;

export function firstCwd(path: string): string | null {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
      if (!line.includes('"cwd"')) continue;
      try {
        const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd;
        if (typeof cwd === "string" && cwd.startsWith("/")) return cwd;
      } catch {
        // the last line can be cut at the buffer edge
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

function findIn(configDir: string, sessionId: string): { path: string; mtimeMs: number } | null {
  let projects: string[];
  try {
    projects = readdirSync(join(configDir, "projects"));
  } catch {
    return null;
  }
  for (const project of projects) {
    const path = join(configDir, "projects", project, `${sessionId}.jsonl`);
    try {
      return { path, mtimeMs: statSync(path).mtimeMs };
    } catch {
      continue;
    }
  }
  return null;
}

export async function locateTranscript(
  sessionId: string,
  preferredAccount: string | undefined,
  deps: TranscriptDeps,
): Promise<TranscriptHit | null> {
  if (!SESSION_ID.test(sessionId)) return null;
  const base = findIn(join(deps.home, ".claude"), sessionId);
  const root = join(deps.home, ".claude-swap-backup", "sessions");
  let names: string[] = [];
  try {
    names = readdirSync(root).sort();
  } catch {
    names = [];
  }
  const accounts = names.length > 0 ? await deps.cswapAccounts() : [];
  const swapped: { path: string; mtimeMs: number; account: string }[] = [];
  for (const name of names) {
    const hit = findIn(join(root, name), sessionId);
    if (!hit) continue;
    const number = Number(/^(\d+)-/.exec(name)?.[1]);
    const email = accounts.find((a) => a.number === number)?.email;
    if (email) swapped.push({ ...hit, account: email });
  }
  const preferred = preferredAccount ? swapped.find((h) => h.account === preferredAccount) : undefined;
  const newest = [...swapped].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  const chosen: { path: string; account?: string } | undefined = preferred ?? base ?? newest;
  if (!chosen) return null;
  const cwd = firstCwd(chosen.path);
  if (!cwd) return null;
  return { path: chosen.path, cwd, ...(chosen.account !== undefined && { account: chosen.account }) };
}
```

Add to `lib/cswap.ts`, below `callerCswapAccount`:

```ts
/** Account number to email, the pairing a cswap config dir's `<number>-` prefix needs. Empty when cswap is missing or answers garbage. */
export async function cswapAccountNumbers(exec: typeof runCapture = runCapture): Promise<{ number: number; email: string }[]> {
  const res = await exec([cswapBin(), "list", "--json"], { timeoutMs: 5_000 });
  if (res.exitCode !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout) as { accounts?: Array<{ number?: unknown; email?: unknown }> };
    return (parsed.accounts ?? []).flatMap((a) =>
      typeof a.number === "number" && typeof a.email === "string" ? [{ number: a.number, email: a.email }] : [],
    );
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/__tests__/agent-adopt.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agent-adopt.ts lib/cswap.ts lib/__tests__/agent-adopt.test.ts
git commit -m "add lib/agent-adopt.ts: find a Claude session's transcript, launch folder and account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `agent:adopt` daemon verb and rt-client wrapper

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (Commands entry near line 818; `COMMAND_NAMES` near line 1163)
- Modify: `packages/rt-client/src/client.ts` (wrapper after `agentResume`, ~line 401)
- Modify: `packages/rt-client/src/index.ts` (export `agentAdopt` beside `agentResume`, ~line 41)
- Modify: `lib/daemon/handlers/agent.ts` (opts, return type, handler)
- Test: `lib/daemon/__tests__/agent-handlers.test.ts`

**Interfaces:**
- Consumes: `locateTranscript`, `TranscriptHit`, `cswapAccountNumbers` from Task 1.
- Produces:
  - Commands entry: `"agent:adopt": { payload: { sessionId: string; repo: string; subject?: string; label?: string }; data: AgentRecord }`
  - rt-client: `export function agentAdopt(a: Commands["agent:adopt"]["payload"], o?: RtClientOptions): Promise<RtResponse<AgentRecord>>`
  - Handler opt: `locateTranscript?: (sessionId: string, preferredAccount: string | undefined) => Promise<TranscriptHit | null>`

- [ ] **Step 1: Write the failing handler tests**

In `lib/daemon/__tests__/agent-handlers.test.ts`, add `locate` to `fresh()`'s `over` and pass it through:

```ts
// in the over type:
  locate?: (sessionId: string, preferredAccount: string | undefined) => Promise<import("../../agent-adopt.ts").TranscriptHit | null>;
// in createAgentHandlers({...}):
    locateTranscript: over.locate,
```

Then append:

```ts
describe("agent:adopt", () => {
  const SID = "3b9e2f1a-0c4d-4e8f-9a7b-1c2d3e4f5a6b";
  const hit = { path: "/x.jsonl", cwd: "/Users/me/src/app", account: "me@example.com" };

  test("records a claude herdr agent at the transcript's launch folder, launching nothing", async () => {
    const calls: string[][] = [];
    const h = fresh({ runner: okRunner(calls), locate: async () => hit });
    const res = await h["agent:adopt"]({ sessionId: SID, repo: REPO, subject: "run:r1", label: "ABC-1" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.data).toMatchObject({
      sessionId: SID, repo: REPO, cwd: "/Users/me/src/app", provider: "claude", surface: "herdr",
      account: "me@example.com", subject: "run:r1", label: "ABC-1",
    });
    expect(calls).toEqual([]);
    expect(getAgent(res.data.id, h.db)?.sessionId).toBe(SID);
  });

  test("a second adopt of the same session returns the same record", async () => {
    let lookups = 0;
    const h = fresh({ locate: async () => { lookups++; return hit; } });
    const first = await h["agent:adopt"]({ sessionId: SID, repo: REPO });
    const second = await h["agent:adopt"]({ sessionId: SID, repo: REPO });
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.data.id).toBe(first.data.id);
    expect(lookups).toBe(1);
  });

  test("refuses when no transcript exists on this Mac", async () => {
    const h = fresh({ locate: async () => null });
    const res = await h["agent:adopt"]({ sessionId: SID, repo: REPO });
    expect(res).toEqual({ ok: false, error: "no transcript for this session on this Mac" });
  });

  test("refuses a missing repo or a session id with a path separator", async () => {
    const h = fresh({ locate: async () => hit });
    expect((await h["agent:adopt"]({ sessionId: SID } as never)).ok).toBe(false);
    expect(await h["agent:adopt"]({ sessionId: "../x", repo: REPO })).toEqual({ ok: false, error: "invalid sessionId" });
  });

  test("passes the agent.claude.account setting as the preferred account", async () => {
    const origHome = process.env.HOME;
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rt-agent-adopt-")));
    process.env.HOME = home;
    try {
      setSetting("agent.claude.account", "work@example.com", "user");
      let preferred: string | undefined;
      const h = fresh({ locate: async (_s, p) => { preferred = p; return hit; } });
      await h["agent:adopt"]({ sessionId: SID, repo: REPO });
      expect(preferred).toBe("work@example.com");
    } finally {
      process.env.HOME = origHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
```

The HOME isolation copies the file's existing "agent:start resolves unset payload fields from settings" block.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/agent-handlers.test.ts -t "agent:adopt"`
Expected: FAIL, `h["agent:adopt"] is not a function` (and a TS error on `locateTranscript`).

- [ ] **Step 3: Add the Commands entry and command name**

In `packages/rt-client/src/commands.ts`, after the `"agent:list"` entry:

```ts
  /** Records an existing Claude session as an agent so `agent:resume` can reopen it; launches nothing. Idempotent per session. */
  "agent:adopt": { payload: { sessionId: string; repo: string; subject?: string; label?: string }; data: AgentRecord };
```

In `COMMAND_NAMES`, after `"agent:list",` add `"agent:adopt",`.

- [ ] **Step 4: Add the handler**

In `lib/daemon/handlers/agent.ts`:

Imports:

```ts
import { homedir } from "os";
import { locateTranscript as defaultLocateTranscript, type TranscriptHit } from "../../agent-adopt.ts";
import { cswapAccountNumbers } from "../../cswap.ts";
```

(`homedir` may already be imported; add only what is missing. `newAgentId` comes from the same state import as `insertAgent`; add it there if absent.)

Opts type, after `insertAgentFn?`:

```ts
  /** Finds a session's transcript for agent:adopt; tests pass a fake. */
  locateTranscript?: (sessionId: string, preferredAccount: string | undefined) => Promise<TranscriptHit | null>;
```

Return type, after the `agent:list` member:

```ts
  & { "agent:adopt": (payload: unknown) => Promise<CommandResult<"agent:adopt">> }
```

In the body, after `const skipSessionCapture = ...`:

```ts
  // os.homedir() is frozen at process start; HOME is what tests repoint.
  const locate = opts.locateTranscript ?? ((sessionId: string, preferred: string | undefined) =>
    defaultLocateTranscript(sessionId, preferred, { home: process.env.HOME ?? homedir(), cswapAccounts: () => cswapAccountNumbers() }));
```

Handler, after `"agent:list"`:

```ts
    "agent:adopt": async (rawPayload: unknown): Promise<CommandResult<"agent:adopt">> => {
      const payload = (rawPayload ?? {}) as Partial<Commands["agent:adopt"]["payload"]>;
      if (typeof payload.repo !== "string" || payload.repo.length === 0) return { ok: false, error: "repo is required" };
      if (typeof payload.sessionId !== "string" || !/^[A-Za-z0-9-]+$/.test(payload.sessionId)) {
        return { ok: false, error: "invalid sessionId" };
      }
      const existing = getAgent(payload.sessionId, db);
      if (existing && existing.sessionId === payload.sessionId) return { ok: true, data: withName(existing, db) };
      const account = fromSetting("agent.claude.account", log);
      const hit = await locate(payload.sessionId, account);
      if (!hit) return { ok: false, error: "no transcript for this session on this Mac" };
      const rec: AgentRecord = {
        id: newAgentId(),
        repo: payload.repo, cwd: hit.cwd, provider: "claude", surface: "herdr",
        sessionId: payload.sessionId,
        createdAt: Date.now(),
      };
      if (hit.account !== undefined) rec.account = hit.account;
      if (typeof payload.subject === "string" && payload.subject.length > 0) rec.subject = payload.subject;
      if (typeof payload.label === "string" && payload.label.length > 0) rec.label = payload.label;
      insertAgentFn(rec, db);
      const saved = getAgent(rec.id, db);
      if (!saved) return { ok: false, error: "state.db busy: agent not recorded" };
      return { ok: true, data: withName(saved, db) };
    },
```

`command-router.ts` spreads `...agentHandlers`, so no router edit is needed. If `bun run typecheck` reports the typed handler map missing `agent:adopt`, the spread is not reaching it; fix at the router.

- [ ] **Step 5: Add the rt-client wrapper**

In `packages/rt-client/src/client.ts`, after `agentResume`:

```ts
export function agentAdopt(
  a: Commands["agent:adopt"]["payload"], o: RtClientOptions = {},
): Promise<RtResponse<AgentRecord>> {
  const payload: Record<string, unknown> = { sessionId: a.sessionId, repo: a.repo };
  if (a.subject !== undefined) payload.subject = a.subject;
  if (a.label !== undefined) payload.label = a.label;
  return rtCommand<AgentRecord>("agent:adopt", payload, { sockPath: o.sockPath, timeoutMs: o.timeoutMs ?? 10_000 });
}
```

Export `agentAdopt` from `packages/rt-client/src/index.ts` beside `agentResume`.

- [ ] **Step 6: Run the tests and build**

Run: `bun test lib/daemon/__tests__/agent-handlers.test.ts -t "agent:adopt"`
Expected: PASS (5 tests).

Run: `(cd packages/rt-client && bun run build) && bun test packages/rt-client/test/dist-freshness.test.ts && bun run typecheck`
Expected: build succeeds, freshness PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/rt-client/src lib/daemon/handlers/agent.ts lib/daemon/__tests__/agent-handlers.test.ts
git commit -m "daemon: agent:adopt records an existing Claude session as a resumable agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Register the run's session on run-start and stage-start

**Files:**
- Create: `lib/runs/adopt.ts`
- Modify: `commands/runs-write.ts` (`run-start` and `stage-start` cases in `dispatch`)
- Test: `lib/runs/__tests__/adopt.test.ts`

**Interfaces:**
- Consumes: the daemon verb `agent:adopt` (Task 2) over `daemonSocketQuery` from `lib/daemon-client.ts`.
- Produces: `export async function adoptRunSession(db: Database, env?: NodeJS.ProcessEnv, timeoutMs?: number): Promise<void>`; the run field `agent` (`produced_by: "run"`) holding the adopted agent id, which Task 4 reads.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/runs/__tests__/adopt.test.ts
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { DAEMON_SOCK_PATH } from "../../daemon-config.ts";
import { runWriteVerb } from "../../../commands/runs-write.ts";
import { adoptRunSession } from "../adopt.ts";
import { createRunDb } from "../write.ts";

type Seen = { path: string; body: Record<string, unknown> };

async function withFakeDaemon<T>(reply: (path: string) => object, body: (seen: Seen[]) => Promise<T>): Promise<T> {
  mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
  if (existsSync(DAEMON_SOCK_PATH)) rmSync(DAEMON_SOCK_PATH);
  const seen: Seen[] = [];
  const server = Bun.serve({
    unix: DAEMON_SOCK_PATH,
    async fetch(req) {
      const path = new URL(req.url).pathname.slice(1);
      seen.push({ path, body: (await req.json()) as Record<string, unknown> });
      return new Response(JSON.stringify(reply(path)));
    },
  });
  try {
    return await body(seen);
  } finally {
    server.stop(true);
    if (existsSync(DAEMON_SOCK_PATH)) rmSync(DAEMON_SOCK_PATH);
  }
}

function dbWithRun(fields: Record<string, [string, number]> = {}): Database {
  const db = createRunDb(join(mkdtempSync(join(tmpdir(), "rt-adopt-run-")), "state.db"));
  db.run("INSERT INTO runs (id, repo, work_type, pipeline, status, started_at) VALUES ('r1', 'demo', 'fix', 'default', 'running', 1)");
  for (const [key, [value, at]] of Object.entries(fields)) {
    db.run("INSERT INTO fields (run_id, key, value, produced_by, at) VALUES ('r1', ?, ?, 'run', ?)", [key, value, at]);
  }
  return db;
}

function agentField(db: Database): string | undefined {
  return (db.query("SELECT value FROM fields WHERE key='agent'").get() as { value: string } | null)?.value;
}

const ADOPTED = (path: string) => (path === "agent:adopt" ? { ok: true, data: { id: "ag-1" } } : { ok: true });

describe("adoptRunSession", () => {
  test("adopts a recorded session and records the agent id", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      const db = dbWithRun({ "claude-session": ["sess-1", 100], ticket: ["ABC-1", 100] });
      await adoptRunSession(db, {});
      expect(seen).toEqual([{ path: "agent:adopt", body: { sessionId: "sess-1", repo: "demo", subject: "run:r1", label: "ABC-1" } }]);
      expect(agentField(db)).toBe("ag-1");
    });
  });

  test("skips when the agent field is newer than the session", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      const db = dbWithRun({ "claude-session": ["sess-1", 100], agent: ["ag-0", 200] });
      await adoptRunSession(db, {});
      expect(seen).toEqual([]);
    });
  });

  test("re-adopts when a newer session took over the run", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      const db = dbWithRun({ "claude-session": ["sess-2", 300], agent: ["ag-0", 200] });
      await adoptRunSession(db, {});
      expect(seen.map((s) => s.body.sessionId)).toEqual(["sess-2"]);
      expect(agentField(db)).toBe("ag-1");
    });
  });

  test("no session recorded, no call", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      await adoptRunSession(dbWithRun(), {});
      expect(seen).toEqual([]);
    });
  });

  test("RT_RUN_EMIT=0 skips the call", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      await adoptRunSession(dbWithRun({ "claude-session": ["sess-1", 100] }), { RT_RUN_EMIT: "0" });
      expect(seen).toEqual([]);
    });
  });

  test("a refused adopt writes nothing and does not throw", async () => {
    await withFakeDaemon(() => ({ ok: false, error: "no transcript for this session on this Mac" }), async () => {
      const db = dbWithRun({ "claude-session": ["sess-1", 100] });
      await adoptRunSession(db, {});
      expect(agentField(db)).toBeUndefined();
    });
  });

  test("a downed daemon is swallowed", async () => {
    if (existsSync(DAEMON_SOCK_PATH)) rmSync(DAEMON_SOCK_PATH);
    const db = dbWithRun({ "claude-session": ["sess-1", 100] });
    await adoptRunSession(db, {}, 200);
    expect(agentField(db)).toBeUndefined();
  });
});

describe("run write verbs adopt the session", () => {
  test("run-start adopts and keeps its output", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      const root = mkdtempSync(join(tmpdir(), "rt-runs-cli-"));
      const r = await runWriteVerb("run-start", ["--repo", "demo", "--work-type", "fix", "--pipeline", "default"],
        { RT_RUNS_ROOT: root, CLAUDE_CODE_SESSION_ID: "sess-1" });
      expect(r.code).toBe(0);
      expect(Object.keys(JSON.parse(r.out))).toEqual(["ok", "runId", "runDb"]);
      expect(seen.map((s) => s.path)).toContain("agent:adopt");
    });
  });

  test("stage-start registers a session the daemon missed at run-start", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-runs-cli-"));
    const started = await runWriteVerb("run-start", ["--repo", "demo", "--work-type", "fix", "--pipeline", "default"],
      { RT_RUNS_ROOT: root, CLAUDE_CODE_SESSION_ID: "sess-1", RT_RUN_EMIT: "0" });
    const runDb = JSON.parse(started.out).runDb as string;
    await withFakeDaemon(ADOPTED, async (seen) => {
      const r = await runWriteVerb("stage-start", ["--stage", "plan"], { RT_RUN_DB: runDb, CLAUDE_CODE_SESSION_ID: "sess-1" });
      expect(r.code).toBe(0);
      expect(seen.filter((s) => s.path === "agent:adopt").map((s) => s.body.sessionId)).toEqual(["sess-1"]);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/runs/__tests__/adopt.test.ts`
Expected: FAIL, `Cannot find module '../adopt.ts'`.

- [ ] **Step 3: Write `adoptRunSession`**

```ts
// lib/runs/adopt.ts
import type { Database } from "bun:sqlite";
import { daemonSocketQuery } from "../daemon-client.ts";
import { runIdentity } from "./write.ts";

function field(db: Database, key: string): { value: string; at: number } | undefined {
  return (db.query("SELECT value, at FROM fields WHERE key = ?").get(key) as { value: string; at: number } | null) ?? undefined;
}

/** Registers the run's Claude session as an rt agent so console can resume it. Best effort, on emitRunUpdated's contract: the daemon's command seam logs a refusal, and nothing here may change a write verb's output. */
export async function adoptRunSession(db: Database, env: NodeJS.ProcessEnv = process.env, timeoutMs = 2_000): Promise<void> {
  if (env.RT_RUN_EMIT === "0") return;
  try {
    const session = field(db, "claude-session");
    if (!session) return;
    const agent = field(db, "agent");
    if (agent && agent.at >= session.at) return;
    const ident = runIdentity(db);
    if (!ident) return;
    const label = field(db, "ticket")?.value ?? ident.runId;
    const res = await daemonSocketQuery(
      "agent:adopt",
      { sessionId: session.value, repo: ident.repo, subject: `run:${ident.runId}`, label },
      timeoutMs,
    );
    const id = res?.ok ? (res.data as { id?: unknown } | undefined)?.id : undefined;
    if (typeof id !== "string") return;
    db.run(
      "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at) SELECT id, 'agent', ?, 'run', ? FROM runs",
      [id, Date.now()],
    );
  } catch {
    // best effort by contract
  }
}
```

- [ ] **Step 4: Wire it into the write verbs**

In `commands/runs-write.ts`, import:

```ts
import { adoptRunSession } from "../lib/runs/adopt.ts";
```

(`openRunDb` is already imported there; if not, import it from `../lib/runs/write.ts`.)

`run-start` case, replace the two lines after `if (!r.ok) return fail(r);`:

```ts
      await emitted(env, { repo, runId: r.runId }, null, "run-start");
      const started = openRunDb(r.runDb);
      try {
        await adoptRunSession(started, env);
      } finally {
        started.close();
      }
      return { out: json({ ok: true, runId: r.runId, runDb: r.runDb }), code: 0 };
```

`stage-start` case, inside the `withRunDbAsync` body after `emitted`:

```ts
        await emitted(env, runIdentity(db), stage, "stage-start");
        await adoptRunSession(db, env);
        return ok(resolved);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test lib/runs/__tests__/adopt.test.ts commands/__tests__/runs-write.test.ts lib/runs/__tests__/identity.test.ts commands/__tests__/agent-verbs-bytes.test.ts`
Expected: PASS. The existing emission tests still see exactly their `run-updated` emissions, because they pass no `CLAUDE_CODE_SESSION_ID`.

- [ ] **Step 6: Commit**

```bash
git add lib/runs/adopt.ts lib/runs/__tests__/adopt.test.ts commands/runs-write.ts
git commit -m "runs: run-start and stage-start register the run's Claude session as an agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Console resume route

**Files:**
- Modify: `apps/console/src/server/runs.ts`
- Modify: every `vi.mock('@mattstack/rt-client', ...)` factory in `apps/console/src/server/`: `runs.test.ts`, `gates.test.ts`, `panes.test.ts`, `enrich.test.ts`, `effectiveInputs.test.ts`, `event-bridge.test.ts`, `settings.test.ts` (add `agentAdopt` and `agentResume` stubs)
- Test: `apps/console/src/server/runs.test.ts`

**Interfaces:**
- Consumes: `agentAdopt` (Task 2), the existing `agentResume` and `getRun`, the run field `agent` (Task 3).
- Produces: `POST /api/runs/:repo/:runId/resume` → `200 { resumed: true, agentId: string }`, `404 { error }`, `409 { error }`, `502 { error }`; RPC path `client.api.runs[':repo'][':runId'].resume.$post({ param })`. Also `export function resumePrompt(runId: string, fields: RunFieldRow[]): string`.

- [ ] **Step 1: Add the stubs to every rt-client mock factory**

In each of the seven factories, add:

```ts
  agentAdopt: vi.fn(async () => ({ ok: false, error: 'not stubbed' })),
  agentResume: vi.fn(async () => ({ ok: false, error: 'not stubbed' })),
```

- [ ] **Step 2: Write the failing route tests**

Append to `apps/console/src/server/runs.test.ts`:

```ts
describe('POST /api/runs/:repo/:runId/resume', () => {
  const field = (key: string, value: string) => ({ key, value, produced_by: 'run', at: 1 });
  const detail = (over: { status?: string; agent?: unknown; fields?: ReturnType<typeof field>[] } = {}) => ({
    ok: true as const,
    data: {
      run: { id: 'run-1', repo: 'demo', status: over.status ?? 'running', agent: over.agent ?? null },
      stages: [],
      decisions: [],
      schemaAhead: false,
      fields: over.fields ?? [
        field('claude-session', 'sess-1'),
        field('worktree', '/wt/ron'),
        field('hold', 'held until the rollout soaks'),
        field('agent', 'ag-1'),
      ],
    },
  });
  const post = () =>
    routes.fetch(new Request('http://localhost/api/runs/demo/run-1/resume', { method: 'POST' }));

  it('resumes the recorded agent with a prompt naming the run, worktree and hold', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.agentResume).mockResolvedValueOnce({ ok: true, data: { id: 'ag-1' } } as never);
    const res = await post();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ resumed: true, agentId: 'ag-1' });
    expect(rt.agentAdopt).not.toHaveBeenCalled();
    expect(rt.agentResume).toHaveBeenCalledWith({
      id: 'ag-1',
      prompt:
        'Run `run-1` is no longer held (held until the rollout soaks). Re-enter the worktree `/wt/ron` and pick the run back up.',
    });
  });

  it('adopts the session when the run predates agent registration', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(
      detail({ fields: [field('claude-session', 'sess-1'), field('worktree', '/wt/ron'), field('ticket', 'ABC-1')] }) as never
    );
    vi.mocked(rt.agentAdopt).mockResolvedValueOnce({ ok: true, data: { id: 'ag-9' } } as never);
    vi.mocked(rt.agentResume).mockResolvedValueOnce({ ok: true, data: { id: 'ag-9' } } as never);
    const res = await post();
    expect(res.status).toBe(200);
    expect(rt.agentAdopt).toHaveBeenCalledWith({ sessionId: 'sess-1', repo: 'demo', subject: 'run:run-1', label: 'ABC-1' });
    expect(vi.mocked(rt.agentResume).mock.calls.at(-1)?.[0]).toEqual({
      id: 'ag-9',
      prompt: 'Run `run-1` is no longer held. Re-enter the worktree `/wt/ron` and pick the run back up.',
    });
  });

  it('404 when the run recorded no session', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail({ fields: [] }) as never);
    expect((await post()).status).toBe(404);
  });

  it('409 when the run has finished', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail({ status: 'done' }) as never);
    expect((await post()).status).toBe(409);
  });

  it('409 when a live agent already has a pane', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail({ agent: { status: 'idle', pane: 'w1:p1' } }) as never);
    expect((await post()).status).toBe(409);
  });

  it('502 with the daemon message when adopt or resume fails', async () => {
    vi.mocked(rt.getRun).mockResolvedValueOnce(detail() as never);
    vi.mocked(rt.agentResume).mockResolvedValueOnce({ ok: false, error: 'herdr unavailable' } as never);
    const res = await post();
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'herdr unavailable' });
  });
});
```

Add `vi.clearAllMocks()` to this file's existing `afterEach` if it has none, so `not.toHaveBeenCalled` sees only this test's calls.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run console:test -- src/server/runs.test.ts`
Expected: FAIL with status 404 from the router (route missing).

- [ ] **Step 4: Add the route**

In `apps/console/src/server/runs.ts`, extend the rt-client import with `agentAdopt`, `agentResume` and `type RunFieldRow`, then add:

```ts
export function resumePrompt(runId: string, fields: RunFieldRow[]): string {
  const value = (key: string) => fields.find(f => f.key === key)?.value;
  const hold = value('hold');
  const worktree = value('worktree');
  const held = `Run \`${runId}\` is no longer held${hold ? ` (${hold})` : ''}.`;
  const next = worktree
    ? `Re-enter the worktree \`${worktree}\` and pick the run back up.`
    : 'Pick the run back up.';
  return `${held} ${next}`;
}
```

Chain the route after the `abandon` POST:

```ts
  .post('/api/runs/:repo/:runId/resume', async c => {
    const { repo: rawRepo, runId } = c.req.param();
    const repo = canonicalRepo(rawRepo);
    const detail = await getRun(runId, repo);
    if (!detail.ok) {
      const status: 404 | 502 = detail.error === 'run not found' ? 404 : 502;
      return c.json({ error: detail.error ?? 'run read failed' }, status);
    }
    const { run, fields } = detail.data!;
    const value = (key: string) => fields.find(f => f.key === key)?.value;
    const session = value('claude-session');
    if (!session) return c.json({ error: 'this run recorded no Claude session' }, 404);
    if (run.status !== 'running') return c.json({ error: 'this run has finished' }, 409);
    if (run.agent && run.agent.status !== 'done') {
      return c.json({ error: 'this run already has a live pane' }, 409);
    }
    let agentId = value('agent');
    if (!agentId) {
      const adopted = await agentAdopt({
        sessionId: session,
        repo,
        subject: `run:${runId}`,
        label: value('ticket') ?? runId,
      });
      if (!adopted.ok || !adopted.data) return c.json({ error: adopted.error ?? 'adopt failed' }, 502);
      agentId = adopted.data.id;
    }
    const resumed = await agentResume({ id: agentId, prompt: resumePrompt(runId, fields) });
    if (!resumed.ok) return c.json({ error: resumed.error ?? 'resume failed' }, 502);
    return c.json({ resumed: true as const, agentId }, 200);
  })
```

`RtResponse<RunDetail>` types `data` as optional even when `ok`, hence the `!`. `run` is `RunSummary`, whose `agent` is `RunAgent | null | undefined`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run console:test -- src/server` and `bun run console:typecheck`
Expected: PASS; typecheck clean (the RPC client sees `resume.$post`).

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/server
git commit -m "console: POST /api/runs/:repo/:runId/resume adopts the run's session and resumes it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Resume button on run detail

**Files:**
- Modify: `apps/console/src/app/runs/RunDetail.tsx` (new `ResumeAction`, `SummaryCard` header group ~line 370)
- Test: `apps/console/src/app/runs/RunDetail.test.tsx`

**Interfaces:**
- Consumes: `client.api.runs[':repo'][':runId'].resume.$post({ param: { repo, runId } })` (Task 4).
- Produces: a `Resume` button (`aria-label="resume run"`).

- [ ] **Step 1: Write the failing tests**

In `RunDetail.test.tsx`, add `const resumePost = vi.fn();` beside the other mocks, and in the `vi.mock('../api')` factory under `':runId'` add:

```ts
            resume: { $post: (...args: unknown[]) => resumePost(...args) },
```

Then add a `describe` block. Copy the `artifactGet`/`seenPost` setup lines from the existing "focus pane" test (around line 540) into each test, or into a local `beforeEach` that does the same:

```ts
describe('resume action', () => {
  const sessionField = { key: 'claude-session', value: 'sess-1', produced_by: 'run', at: 1 };
  const stubSideQueries = () => {
    artifactGet.mockResolvedValue({ ok: true, status: 200, json: async () => ({ lines: [], truncated: false }) });
    seenPost.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  };

  it('offers Resume for a running run with a session and no live pane', async () => {
    stubSideQueries();
    detailGet.mockResolvedValue(detailResponse({
      ...FIXTURE,
      run: run({ status: 'running', agent: null }),
      fields: [...FIXTURE.fields, sessionField],
    }));
    resumePost.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ resumed: true, agentId: 'ag-1' }) });

    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'resume run' }));

    expect(resumePost).toHaveBeenCalledWith({ param: { repo: 'repo-tools', runId: 'run-1' } });
    await screen.findByText('Resumed the run in a new pane');
  });

  it('shows the server message when resume fails', async () => {
    stubSideQueries();
    detailGet.mockResolvedValue(detailResponse({
      ...FIXTURE,
      run: run({ status: 'running', agent: null }),
      fields: [...FIXTURE.fields, sessionField],
    }));
    resumePost.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: 'no transcript for this session on this Mac' }) });

    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'resume run' }));

    await screen.findByText('no transcript for this session on this Mac');
  });

  it('shows Focus pane, not Resume, while a live agent holds the pane', async () => {
    stubSideQueries();
    detailGet.mockResolvedValue(detailResponse({
      ...FIXTURE,
      run: run({ status: 'running', agent: { status: 'idle', pane: 'w1:p1' } }),
      fields: [...FIXTURE.fields, sessionField],
    }));

    renderDetail();
    await screen.findByRole('button', { name: 'focus pane' });
    expect(screen.queryByRole('button', { name: 'resume run' })).not.toBeInTheDocument();
  });

  it('shows no Resume for a finished run or one with no session', async () => {
    stubSideQueries();
    detailGet.mockResolvedValue(detailResponse({ ...FIXTURE, run: run({ status: 'done' }), fields: [...FIXTURE.fields, sessionField] }));
    const { unmount } = renderDetail();
    await screen.findByTestId('summary-card');
    expect(screen.queryByRole('button', { name: 'resume run' })).not.toBeInTheDocument();
    unmount();

    detailGet.mockResolvedValue(detailResponse({ ...FIXTURE, run: run({ status: 'running', agent: null }) }));
    renderDetail();
    await screen.findByTestId('summary-card');
    expect(screen.queryByRole('button', { name: 'resume run' })).not.toBeInTheDocument();
  });
});
```

Toasts persist across tests (the notifications store is module-global; see the comment on the existing second focus test). If a toast from an earlier test makes `findByText` ambiguous, follow that test's pattern for clearing notifications.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run console:test -- src/app/runs/RunDetail.test.tsx`
Expected: FAIL, no button named `resume run`.

- [ ] **Step 3: Add `ResumeAction` and show it**

In `RunDetail.tsx`, add `useState` to the `react` import, then add after `FocusPaneAction`:

```tsx
function ResumeAction({ repo, runId }: { repo: string; runId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="xs"
      variant="light"
      leftSection={<Icons.rotateCcw size={16} />}
      aria-label="resume run"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await client.api.runs[':repo'][':runId'].resume.$post({
            param: { repo, runId },
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            notifications.error(body?.error ?? "couldn't resume the run");
            return;
          }
          notifications.success('Resumed the run in a new pane');
          await queryClient.invalidateQueries({
            queryKey: ['run', repo, runId],
          });
        } catch {
          notifications.error("couldn't resume the run");
        } finally {
          setBusy(false);
        }
      }}
    >
      Resume
    </Button>
  );
}
```

In `SummaryCard`, after `showFocusPane`:

```ts
  const showResume =
    run.status === 'running' &&
    !showFocusPane &&
    Boolean(byKey.get('claude-session')?.value);
```

In the header `Group`, after the Focus pane line:

```tsx
          {showResume && <ResumeAction repo={repo} runId={run.id} />}
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `bun run console:test -- src/app/runs` then `bun run console:typecheck` then `bun run console:lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/runs/RunDetail.tsx apps/console/src/app/runs/RunDetail.test.tsx
git commit -m "console: Resume button on a running run whose pane is gone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verify in the browser, then live after merge

The button's visibility needs no daemon change (it reads existing run data), so it can be seen from the worktree before merge. Pressing it needs `agent:adopt`, which needs the dev daemon running the merged code.

- [ ] **Step 1: Run the console from the worktree**

Run: `bun run console:build`, then start the dev server the way `apps/console/package.json`'s `dev` script does (port 11011, proxied to the live daemon). Open `a held run's detail page`.

- [ ] **Step 2: Screenshot both schemes with Fast Browser**

Delegate to `fast-browser:browser-driver`: screenshot the run header in light and dark (toggle with the rail's scheme control). Check the Resume button sits beside the liveness chip, reads at both schemes, and the header does not wrap. Say plainly what looks wrong. Do not press Resume (the daemon has no `agent:adopt` yet).

- [ ] **Step 3: Fix anything the screenshots show, re-shoot, commit**

```bash
git commit -am "console: <what the screenshots showed>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Skip the commit when nothing changed.

- [ ] **Step 4: After merge and daemon restart, live check with Matt**

With Matt's go: press Resume on a real held run. Expect a herdr pane in the session's launch folder that reopens the session and receives the re-entry prompt. Then confirm `rt agent list --json` shows the adopted record with `subject: "run:<run id>"`. If `claude --resume` cannot find the session from that folder, stop and report: the spec's launch-folder assumption is wrong.
