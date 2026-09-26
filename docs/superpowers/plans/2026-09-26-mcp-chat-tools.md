# MCP chat tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 13 `chat_*` MCP tools so skills can run every routine `rt chat` verb without Bash, each acting only as this session's own chat identity.

**Architecture:** A new `lib/mcp/chat-tools.ts` exports `chatToolDefs(deps)` (dependency-injected like `herd-tools.ts`), appended to the roster in `lib/mcp/tools.ts`. Most tools call rt-client chat wrappers in-process; `chat_sign_in` spawns the CLI through a `spawnRtJson` helper lifted out of `runRtVerb`. `parseDuration` moves from `commands/events.ts` into `lib/duration.ts`.

**Tech Stack:** Bun, TypeScript, `bun:test`, the rt-client package (`packages/rt-client/src`).

**Spec:** `docs/superpowers/specs/2026-09-26-mcp-chat-tools-design.md`

## Global Constraints

- rt is a PUBLIC repo: no employer, customer or team-pack names anywhere (code, tests, comments, commits).
- No em dashes or en dashes anywhere. Use `...` or rephrase.
- Comments state only constraints the code cannot show (parity anchors, ordering traps, invariants). No narration, no review or ticket references, no decision history.
- Every MCP tool is a standing no-prompt grant: no tool takes a handle, session id or pane to act as. `--as` (per-call override) and `--pane` never reach the CLI or daemon from a tool.
- `lib/mcp` imports nothing from `commands/` except `commands/runs-write.ts`. Never import `commands/chat.ts`, `commands/herd.ts` or `commands/events.ts` from `lib/mcp`.
- The server does not validate `inputSchema`; every handler validates its own input with `checkRequired` / `checkOptional` and returns `err(...)`, never throws.
- Every tool's `inputSchema` is `{ type: "object", ..., additionalProperties: false }` and its description is longer than 20 characters.
- The roster is append-only: new tools go at the END of `mcpTools()`, `NAMES` (`lib/mcp/__tests__/tools.test.ts`), `EXPECTED_TOOL_NAMES` and `PUBLISHED` (`e2e/tests/mcp-serve.test.ts`).
- Bash in this worktree: one plain command per call; no heredocs, no `&&`, no `;`, no `git -C`, no loops. Run `bun test` from the repo root.
- A built `dist/rt` runs only through the e2e harness or under an isolated HOME.
- Write fence: `lib/mcp/`, `lib/duration.ts`, `lib/__tests__/duration.test.ts`, `lib/__tests__/events-cli.test.ts`, `commands/events.ts` (the parseDuration move only), `e2e/tests/mcp-serve.test.ts`, `docs/superpowers/`, `.superpowers/`. Nothing else.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A tool called in a session that never signed in: every handle tool must return the shared `SIGN_IN_HINT` error and make no daemon call (pinned per tool in Tasks 4 and 6).
- A caller sneaking an identity override in through extra input keys (`as`, `handle`, `session`, `pane` on tools that do not declare them): the handler must ignore them and send only the session's own handle (pinned in Task 4's "ignores a caller handle" test and Task 5's argv test).
- `chat_sign_in` after `/clear` or in a pane whose Claude process died: must refuse with no spawn (Task 5).
- `chat_invite` note carrying terminal control bytes (ESC, Ctrl-C, tab): must refuse before the daemon (Task 6).
- `chat_read` with `since: "5m"` vs `since: "abc"`: the grammar must match the CLI exactly, since both parse through `lib/duration.ts` (Task 1 and Task 4).

---

## File Structure

- Create `lib/duration.ts`: `parseDuration(s)`, moved verbatim from `commands/events.ts`.
- Create `lib/__tests__/duration.test.ts`: the moved parseDuration tests.
- Modify `commands/events.ts`: import `parseDuration` from `../lib/duration.ts` and re-export it.
- Modify `lib/__tests__/events-cli.test.ts`: drop the moved parseDuration block.
- Modify `lib/mcp/rt-verb.ts`: lift `spawnRtJson` out of `runRtVerb`; export `RtVerbResult`.
- Modify `lib/mcp/__tests__/rt-verb.test.ts`: add `spawnRtJson` tests.
- Modify `lib/mcp/shared.ts`: `SIGN_IN_HINT`, `requireChatHandle`, `CHAT_NAME`, `checkChatName`.
- Modify `lib/mcp/tools.ts`: use the shared helpers; update the five existing chat tool descriptions; append `...chatToolDefs()`.
- Create `lib/mcp/chat-tools.ts`: the 13 tools.
- Create `lib/mcp/__tests__/chat-tools.test.ts`.
- Modify `lib/mcp/__tests__/tools.test.ts` (`NAMES`) and `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES`, `PUBLISHED`).

---

### Task 1: Lift parseDuration into lib/duration.ts

**Files:**
- Create: `lib/duration.ts`
- Create: `lib/__tests__/duration.test.ts`
- Modify: `commands/events.ts:19-25` (the `parseDuration` function)
- Modify: `lib/__tests__/events-cli.test.ts:1-17`

**Interfaces:**
- Produces: `export function parseDuration(s: string): number | null` in `lib/duration.ts` (milliseconds; `null` on garbage; bare number = seconds). `commands/events.ts` still exports `parseDuration` (re-export), so `commands/chat.ts` and `commands/gate.ts` keep `import { parseDuration } from "./events.ts"` unchanged.

- [ ] **Step 1: Write the test file `lib/__tests__/duration.test.ts`**

```ts
import { describe, test, expect } from "bun:test";
import { parseDuration } from "../duration.ts";
import { parseDuration as fromEvents } from "../../commands/events.ts";

describe("parseDuration", () => {
  test("suffixes", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
  });
  test("bare number = seconds", () => expect(parseDuration("45")).toBe(45_000));
  test("garbage is null", () => {
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("-5s")).toBeNull();
  });
  test("commands/events.ts re-exports the same function", () => {
    expect(fromEvents).toBe(parseDuration);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/__tests__/duration.test.ts`
Expected: FAIL, cannot resolve `../duration.ts`.

- [ ] **Step 3: Create `lib/duration.ts`**

```ts
export function parseDuration(s: string): number | null {
  const m = /^(\d+)(ms|s|m|h)?$/.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  const unit = m[2] ?? "s";
  return n * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
}
```

- [ ] **Step 4: Replace the function in `commands/events.ts`**

Delete the `export function parseDuration(...) { ... }` block (lines 19-25) and add, beside the existing `import { daemonQuery } ...` line:

```ts
import { parseDuration } from "../lib/duration.ts";
export { parseDuration };
```

- [ ] **Step 5: Drop the moved block from `lib/__tests__/events-cli.test.ts`**

Change line 2 to `import { nextWaitMs } from "../../commands/events.ts";` and delete the whole `describe("parseDuration", ...)` block. The `nextWaitMs` block stays.

- [ ] **Step 6: Run the tests**

Run: `bun test lib/__tests__/duration.test.ts lib/__tests__/events-cli.test.ts`
Expected: PASS.

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/duration.ts lib/__tests__/duration.test.ts commands/events.ts lib/__tests__/events-cli.test.ts
git commit -m "lift parseDuration into lib/duration.ts"
```
(Message body ends with the Co-Authored-By trailer.)

---

### Task 2: Lift spawnRtJson out of runRtVerb

**Files:**
- Modify: `lib/mcp/rt-verb.ts`
- Test: `lib/mcp/__tests__/rt-verb.test.ts`

**Interfaces:**
- Produces, in `lib/mcp/rt-verb.ts`:
  - `export type RtVerbResult = { ok: true; body: unknown } | { ok: false; error: string };`
  - `export async function spawnRtJson(path: string[], rest: string[], opts: { cwd?: string; timeoutMs?: number }, deps: Pick<RtVerbDeps, "selfArgv" | "spawn"> = realRtVerbDeps()): Promise<RtVerbResult>`: refuses any `rest` arg holding a control character, appends `--json` unless present, spawns `[...selfArgv(), ...path, ...rest]` with env `{ RT_BATCH: "1", RT_SKIP_SETUP: "1" }` (execWithTimeout overlays it on `process.env`) and `timeoutMs ?? RT_VERB_TIMEOUT_MS`, and maps the result exactly as `runRtVerb` does today (verb label `rt ${path.join(" ")}`).
- `runRtVerb` keeps its signature and behavior; after its leaf, flag, path and cwd checks it calls `spawnRtJson(leaf.path, forwarded, { cwd, timeoutMs: cap }, deps)`.

- [ ] **Step 1: Add failing tests at the end of `lib/mcp/__tests__/rt-verb.test.ts`**

Add `spawnRtJson` to the existing import from `../rt-verb.ts`, then append:

```ts
describe("spawnRtJson", () => {
  function spawnDeps(result: ExecResult, calls: { argv: string[]; opts: unknown }[]) {
    return {
      selfArgv: () => ["/bin/rt", "--no-env-file"],
      spawn: async (argv: string[], opts: unknown) => {
        calls.push({ argv, opts });
        return result;
      },
    };
  }

  test("prefixes selfArgv, appends --json, sets the batch env and the default cap", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    const r = await spawnRtJson(["chat", "sign-in"], ["--session", "s1"], { cwd: "/work" }, spawnDeps(ok('{"ok":true,"handle":"ann"}'), calls));
    expect(r).toEqual({ ok: true, body: { ok: true, handle: "ann" } });
    expect(calls[0]!.argv).toEqual(["/bin/rt", "--no-env-file", "chat", "sign-in", "--session", "s1", "--json"]);
    expect(calls[0]!.opts).toEqual({ cwd: "/work", env: { RT_BATCH: "1", RT_SKIP_SETUP: "1" }, timeoutMs: RT_VERB_TIMEOUT_MS });
  });

  test("does not add a second --json", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    await spawnRtJson(["chat", "sign-in"], ["--json"], {}, spawnDeps(ok("{}"), calls));
    expect(calls[0]!.argv.filter((a) => a === "--json")).toHaveLength(1);
  });

  test("refuses a control character with no spawn", async () => {
    const calls: { argv: string[]; opts: unknown }[] = [];
    const r = await spawnRtJson(["chat", "sign-in"], ["--status", "a\u001bb"], {}, spawnDeps(ok("{}"), calls));
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test("maps a timeout and an exit-2 envelope as runRtVerb does", async () => {
    const t = await spawnRtJson(["chat", "sign-in"], [], { timeoutMs: 5000 }, spawnDeps({ code: 124, stdout: "", stderr: "" }, []));
    expect(t).toEqual({ ok: false, error: "rt chat sign-in timed out after 5s" });
    const e = await spawnRtJson(["chat", "sign-in"], [], {}, spawnDeps({ code: 2, stdout: '{"ok":false,"error":"no session id"}', stderr: "" }, []));
    expect(e).toEqual({ ok: false, error: "no session id" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/mcp/__tests__/rt-verb.test.ts`
Expected: FAIL, `spawnRtJson` is not exported.

- [ ] **Step 3: Refactor `lib/mcp/rt-verb.ts`**

Replace `type RtVerbResult = ...` with `export type RtVerbResult = { ok: true; body: unknown } | { ok: false; error: string };`. Add, above `runRtVerb`:

```ts
export async function spawnRtJson(
  path: string[],
  rest: string[],
  opts: { cwd?: string; timeoutMs?: number },
  deps: Pick<RtVerbDeps, "selfArgv" | "spawn"> = realRtVerbDeps(),
): Promise<RtVerbResult> {
  if (rest.some((a) => CONTROL_CHAR.test(a))) return fail("args must not contain a control character");
  const verb = `rt ${path.join(" ")}`;
  const args = rest.includes("--json") ? rest : [...rest, "--json"];
  const cap = opts.timeoutMs ?? RT_VERB_TIMEOUT_MS;
  const res = await deps.spawn([...deps.selfArgv(), ...path, ...args], {
    cwd: opts.cwd,
    env: { RT_BATCH: "1", RT_SKIP_SETUP: "1" },
    timeoutMs: cap,
  });

  const parsed = parseJson(res.stdout);
  if (res.code === 0) return parsed.ok ? { ok: true, body: parsed.value } : fail(`${verb} returned non-JSON output: ${tail(res.stdout)}`);
  if (res.code === 124) return fail(`${verb} timed out after ${cap / 1000}s`);
  const envelopeMessage = parsed.ok ? errorText(parsed.value) : null;
  if (res.code === 2 && envelopeMessage) return fail(envelopeMessage);
  const detail = envelopeMessage ?? (tail(res.stderr) || tail(res.stdout));
  return fail(`${verb} failed (exit ${res.code})${detail ? `: ${detail}` : ""}`);
}
```

In `runRtVerb`, replace everything from `const rest = forwarded.includes("--json") ...` to the end of the function with:

```ts
  return spawnRtJson(leaf.path, forwarded, { cwd, timeoutMs: leaf.node.agentTimeoutMs ?? RT_VERB_TIMEOUT_MS }, deps);
```

and delete the now-unused `const verb = ...` line only if TypeScript flags it (it is still used in the flag error messages, so it normally stays).

- [ ] **Step 4: Run the tests**

Run: `bun test lib/mcp/__tests__/rt-verb.test.ts lib/mcp/__tests__/herd-tools.test.ts`
Expected: PASS, including every pre-existing `runRtVerb` test unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/rt-verb.ts lib/mcp/__tests__/rt-verb.test.ts
git commit -m "mcp: lift spawnRtJson out of runRtVerb"
```

---

### Task 3: Shared chat identity helpers

**Files:**
- Modify: `lib/mcp/shared.ts`
- Modify: `lib/mcp/tools.ts:17,43-50` and the five chat tool descriptions (`chat_post`, `chat_dm`, `chat_ack`, `chat_claim`, `chat_release`)
- Test: `lib/mcp/__tests__/tools.test.ts`

**Interfaces:**
- Produces, in `lib/mcp/shared.ts`:
  - `export const SIGN_IN_HINT = "no signed-in chat session for this session; call chat_sign_in first, or, if this session was /cleared, run \`rt chat sign-in\` and the other chat verbs in Bash";`
  - `export function requireChatHandle(env: NodeJS.ProcessEnv, read: (id: string | undefined) => ChatSession | null = readChatSession): { handle: string } | { error: string }`
  - `export const CHAT_NAME = /^[a-z0-9._-]+$/;` (parity anchor: `isValidChatName` in `lib/state/chat-store.ts`)
  - `export function checkChatName(field: string, value: unknown): string | undefined`: `undefined` when `value` is a string matching `CHAT_NAME`, else `"<field>" must be a chat name (lowercase letters, digits, . _ -)`.
- `tools.ts` imports `requireChatHandle` from `./shared.ts` and drops its local copy, its `SIGN_IN_HINT` constant and its `readChatSession` import.

- [ ] **Step 1: Write failing tests in `lib/mcp/__tests__/tools.test.ts`**

Add inside `describe("mcpTools", ...)`:

```ts
  test("the existing chat tools point unsigned sessions at chat_sign_in", async () => {
    for (const name of ["chat_post", "chat_dm", "chat_ack", "chat_claim", "chat_release"]) {
      const tool = mcpTools().find((t) => t.name === name)!;
      expect(tool.description, name).toContain("chat_sign_in");
      expect(tool.description, name).not.toContain("in bash first");
    }
    const tool = mcpTools().find((t) => t.name === "chat_ack")!;
    const res = await tool.handler({ id: 1 }, {} as NodeJS.ProcessEnv);
    expect(res.error).toContain("chat_sign_in");
    expect(res.error).toContain("rt chat sign-in");
  });
```

And add a new file-level `describe` for the helpers (import `checkChatName`, `requireChatHandle` from `../shared.ts`):

```ts
describe("chat helpers", () => {
  test("requireChatHandle reads only the env session's file", () => {
    const seen: Array<string | undefined> = [];
    const read = (id: string | undefined) => { seen.push(id); return id === "s1" ? { sessionId: "s1", handle: "ann", baseHandle: "ann", signedInAt: 1 } : null; };
    expect(requireChatHandle({ CLAUDE_CODE_SESSION_ID: "s1" } as NodeJS.ProcessEnv, read)).toEqual({ handle: "ann" });
    expect("error" in requireChatHandle({} as NodeJS.ProcessEnv, read)).toBe(true);
    expect(seen).toEqual(["s1", undefined]);
  });

  test("checkChatName matches the daemon's name rule", () => {
    expect(checkChatName("room", "build-1.x_y")).toBeUndefined();
    for (const bad of ["Build", "a b", "", "a/b", 7]) expect(checkChatName("room", bad), String(bad)).toContain('"room"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: FAIL (descriptions still say "in bash first"; helpers not exported).

- [ ] **Step 3: Implement in `lib/mcp/shared.ts`**

Add imports `import { readChatSession, type ChatSession } from "../chat-session.ts";` and:

```ts
export const SIGN_IN_HINT = "no signed-in chat session for this session; call chat_sign_in first, or, if this session was /cleared, run `rt chat sign-in` and the other chat verbs in Bash";

/** No derived-handle fallback: a tool call with no session file is a hard error, unlike the CLI's resolveHandle. */
export function requireChatHandle(
  env: NodeJS.ProcessEnv,
  read: (id: string | undefined) => ChatSession | null = readChatSession,
): { handle: string } | { error: string } {
  const session = read(env.CLAUDE_CODE_SESSION_ID);
  if (!session) return { error: SIGN_IN_HINT };
  return { handle: session.handle };
}

/** Mirrors isValidChatName (lib/state/chat-store.ts), which lib/mcp does not import. */
export const CHAT_NAME = /^[a-z0-9._-]+$/;

export function checkChatName(field: string, value: unknown): string | undefined {
  if (typeof value === "string" && CHAT_NAME.test(value)) return undefined;
  return `"${field}" must be a chat name (lowercase letters, digits, . _ -)`;
}
```

- [ ] **Step 4: Update `lib/mcp/tools.ts`**

Delete the local `SIGN_IN_HINT`, the local `requireChatHandle` and the `readChatSession` import; add `requireChatHandle` to the `./shared.ts` import list. In each of the five chat tool descriptions replace `run \`rt chat sign-in\` in bash first.` with `call chat_sign_in first.` Keep each description's first sentence.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/mcp`
Expected: PASS. (The two older tests asserting `toContain("rt chat sign-in")` still pass: the new hint names both paths.)

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/shared.ts lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts
git commit -m "mcp: share requireChatHandle and point chat tools at chat_sign_in"
```

---

### Task 4: chat-tools.ts with the handle and session tools, wired into the roster

Nine tools: `chat_read`, `chat_mark`, `chat_rooms`, `chat_who`, `chat_buddies`, `chat_join`, `chat_leave`, `chat_away`, `chat_back`.

**Files:**
- Create: `lib/mcp/chat-tools.ts`
- Create: `lib/mcp/__tests__/chat-tools.test.ts`
- Modify: `lib/mcp/tools.ts` (import `chatToolDefs`; append `...chatToolDefs(),` after `...herdToolDefs(),`)
- Modify: `lib/mcp/__tests__/tools.test.ts` (`NAMES`)
- Modify: `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES`, `PUBLISHED`)

**Interfaces:**
- Consumes: `requireChatHandle`, `checkChatName`, `SIGN_IN_HINT`, `checkRequired`, `checkOptional`, `err`, `ok`, `fromResponse`, `McpToolDef` from `./shared.ts`; `parseDuration` from `../duration.ts`; `selfPaneRef` from `../self-pane.ts`.
- Produces:

```ts
export interface ChatToolDeps {
  read: typeof chatRead; messages: typeof chatMessages; mark: typeof chatMark; rooms: typeof chatRooms;
  who: typeof chatWho; buddies: typeof chatBuddies; join: typeof chatJoin; leave: typeof chatLeave;
  away: typeof chatAway; back: typeof chatBack;
  signOut: typeof chatSignOut; archive: typeof chatArchive; invite: typeof chatInvite;
  session: (id: string | undefined) => ChatSession | null;
  deleteSession: (id: string) => void;
  spawnRt: (path: string[], rest: string[], opts: { cwd?: string; timeoutMs?: number }) => Promise<RtVerbResult>;
  isDir: (path: string) => boolean;
  serverCwd: () => string | undefined;
  humanHandle: () => string | undefined;
  sessionAlive: (id: string) => boolean;
  now: () => number;
}
export const realChatToolDeps: ChatToolDeps;
export function chatToolDefs(deps?: ChatToolDeps): McpToolDef[];
```

Tasks 5 and 6 add tools to the array `chatToolDefs` returns and use `signOut`, `deleteSession`, `spawnRt`, `isDir`, `humanHandle`, `sessionAlive`, `archive`, `invite`. All deps are defined in this task so later tasks only add tools.

- [ ] **Step 1: Write the failing tests `lib/mcp/__tests__/chat-tools.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { chatToolDefs, type ChatToolDeps } from "../chat-tools.ts";
import { SIGN_IN_HINT } from "../shared.ts";

const SESSION = { sessionId: "s1", handle: "ann", baseHandle: "ann", signedInAt: 1 };
const ENV = { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "w1:p2" } as NodeJS.ProcessEnv;

type Call = { fn: string; a: any; o?: any };

function fake(opts: { signedIn?: boolean; fail?: string; who?: unknown; alive?: boolean; human?: string; spawn?: unknown; dirs?: string[] } = {}) {
  const calls: Call[] = [];
  const rec = (fn: string, data: unknown = {}) => (async (a?: unknown, o?: unknown) => {
    calls.push({ fn, a, o });
    return opts.fail ? { ok: false, error: opts.fail } : { ok: true, data };
  }) as any;
  const deps: ChatToolDeps = {
    read: rec("read", { rooms: [{ room: "build", messages: [] }] }),
    messages: rec("messages", { messages: [{ id: 9 }] }),
    mark: rec("mark"),
    rooms: rec("rooms", { rooms: [] }),
    who: rec("who", opts.who ?? { members: [{ room: "build", handle: "ann" }] }),
    buddies: (async (o?: unknown) => { calls.push({ fn: "buddies", a: undefined, o }); return { ok: true, data: { buddies: [] } }; }) as any,
    join: rec("join", { handle: "ann", memberCount: 2, unread: 0 }),
    leave: rec("leave"),
    away: rec("away"),
    back: rec("back"),
    signOut: rec("signOut", { sessionId: "s1" }),
    archive: rec("archive", { room: "build", archivedAt: 5 }),
    invite: rec("invite", { delivered: "accepted", paneId: "w2:p1" }),
    session: (id) => (opts.signedIn === false || id !== "s1" ? null : SESSION),
    deleteSession: (id) => { calls.push({ fn: "deleteSession", a: id }); },
    spawnRt: async (path, rest, o) => { calls.push({ fn: "spawnRt", a: { path, rest }, o }); return (opts.spawn as any) ?? { ok: true, body: { ok: true, handle: "ann", room: "rt" } }; },
    isDir: (p) => (opts.dirs ?? ["/work"]).includes(p),
    serverCwd: () => "/server",
    humanHandle: () => opts.human ?? "pat",
    sessionAlive: () => opts.alive ?? true,
    now: () => 1_000_000,
  };
  const tools = chatToolDefs(deps);
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  return { calls, tool };
}

const HANDLE_TOOLS: Array<[string, Record<string, unknown>]> = [
  ["chat_read", {}], ["chat_mark", {}], ["chat_rooms", {}], ["chat_join", { room: "build" }], ["chat_leave", { room: "build" }],
];

describe("chat tools: identity", () => {
  test.each(HANDLE_TOOLS)("%s refuses an unsigned session with no daemon call", async (name, input) => {
    const f = fake({ signedIn: false });
    const r = await f.tool(name).handler(input, ENV);
    expect(r).toEqual({ ok: false, body: undefined, error: SIGN_IN_HINT });
    expect(f.calls).toEqual([]);
  });

  test.each(HANDLE_TOOLS)("%s ignores a caller handle and sends the session's own", async (name, input) => {
    const f = fake();
    await f.tool(name).handler({ ...input, handle: "mallory", as: "mallory" }, ENV);
    expect(f.calls[0]!.a.handle).toBe("ann");
  });

  test("away and back use the env session id and refuse without one", async () => {
    const f = fake();
    await f.tool("chat_away").handler({ text: "rebasing" }, ENV);
    await f.tool("chat_back").handler({}, ENV);
    expect(f.calls).toEqual([
      { fn: "away", a: { sessionId: "s1", text: "rebasing" }, o: undefined },
      { fn: "back", a: { sessionId: "s1" }, o: undefined },
    ]);
    const g = fake();
    expect((await g.tool("chat_away").handler({ text: "x" }, {} as NodeJS.ProcessEnv)).ok).toBe(false);
    expect((await g.tool("chat_back").handler({}, {} as NodeJS.ProcessEnv)).ok).toBe(false);
    expect(g.calls).toEqual([]);
  });

  test("who and buddies need no sign-in", async () => {
    const f = fake({ signedIn: false });
    expect((await f.tool("chat_who").handler({ room: "build" }, {} as NodeJS.ProcessEnv)).ok).toBe(true);
    expect((await f.tool("chat_buddies").handler({}, {} as NodeJS.ProcessEnv)).ok).toBe(true);
  });
});

describe("chat_read", () => {
  test("defaults limit to 20 and returns the rooms", async () => {
    const f = fake();
    const r = await f.tool("chat_read").handler({ room: "build" }, ENV);
    expect(r).toEqual({ ok: true, body: { rooms: [{ room: "build", messages: [] }] } });
    expect(f.calls[0]!.a).toEqual({ handle: "ann", room: "build", limit: 20 });
  });

  test("since is a peek from now minus the CLI duration", async () => {
    const f = fake();
    await f.tool("chat_read").handler({ since: "5m" }, ENV);
    expect(f.calls[0]!.a.sinceMs).toBe(1_000_000 - 300_000);
  });

  test("a bad since, limit or last is refused before the daemon", async () => {
    for (const input of [{ since: "abc" }, { limit: 0 }, { limit: "5" }, { room: "build", last: 1.5 }, { last: 3 }, { room: "build", last: 3, since: "5m" }]) {
      const f = fake();
      const r = await f.tool("chat_read").handler(input, ENV);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });

  test("last reads the newest page then marks the room", async () => {
    const f = fake();
    const r = await f.tool("chat_read").handler({ room: "build", last: 3 }, ENV);
    expect(r).toEqual({ ok: true, body: { rooms: [{ room: "build", messages: [{ id: 9 }] }] } });
    expect(f.calls.map((c) => [c.fn, c.a])).toEqual([["messages", { room: "build", limit: 3 }], ["mark", { handle: "ann", room: "build" }]]);
  });

  test("a bad room name is refused", async () => {
    const f = fake();
    expect((await f.tool("chat_read").handler({ room: "Bad Room" }, ENV)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
});

describe("chat_mark, chat_join, chat_leave, chat_rooms, chat_who", () => {
  test("mark passes room and upto; upto needs a room and a positive integer", async () => {
    const f = fake();
    expect(await f.tool("chat_mark").handler({ room: "build", upto: 4 }, ENV)).toEqual({ ok: true, body: {} });
    expect(f.calls[0]!.a).toEqual({ handle: "ann", room: "build", upto: 4 });
    for (const input of [{ upto: 4 }, { room: "build", upto: 0 }, { room: "build", upto: 2.5 }]) {
      const g = fake();
      expect((await g.tool("chat_mark").handler(input, ENV)).ok, JSON.stringify(input)).toBe(false);
      expect(g.calls).toEqual([]);
    }
  });

  test("join sends wakeOn, the given cwd and the server's own pane ref", async () => {
    const f = fake();
    const r = await f.tool("chat_join").handler({ room: "build", wakeOn: "all", cwd: "/work" }, ENV);
    expect(r).toEqual({ ok: true, body: { room: "build", handle: "ann", memberCount: 2, unread: 0 } });
    expect(f.calls[0]!.a).toEqual({ room: "build", handle: "ann", wakeOn: "all", cwd: "/work", pane: "w1:p2" });
  });

  test("join defaults cwd to the server's and refuses a bad wakeOn or cwd", async () => {
    const f = fake();
    await f.tool("chat_join").handler({ room: "build" }, ENV);
    expect(f.calls[0]!.a.cwd).toBe("/server");
    for (const input of [{ room: "build", wakeOn: "loud" }, { room: "build", cwd: "rel" }, { room: "build", cwd: "/missing" }, {}]) {
      const g = fake();
      expect((await g.tool("chat_join").handler(input, ENV)).ok, JSON.stringify(input)).toBe(false);
      expect(g.calls).toEqual([]);
    }
  });

  test("leave, rooms and who pass through", async () => {
    const f = fake();
    await f.tool("chat_leave").handler({ room: "build" }, ENV);
    await f.tool("chat_rooms").handler({}, ENV);
    await f.tool("chat_who").handler({ room: "build" }, ENV);
    expect(f.calls.map((c) => [c.fn, c.a])).toEqual([["leave", { room: "build", handle: "ann" }], ["rooms", { handle: "ann" }], ["who", { room: "build" }]]);
  });

  test("who requires a room", async () => {
    const f = fake();
    expect((await f.tool("chat_who").handler({}, ENV)).ok).toBe(false);
  });

  test("a daemon error comes back as the tool error", async () => {
    const f = fake({ fail: "rt daemon unreachable" });
    const r = await f.tool("chat_rooms").handler({}, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rt daemon unreachable");
  });

  test("away refuses empty or non-string text", async () => {
    for (const input of [{}, { text: "" }, { text: 3 }]) {
      const f = fake();
      expect((await f.tool("chat_away").handler(input, ENV)).ok, JSON.stringify(input)).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/mcp/__tests__/chat-tools.test.ts`
Expected: FAIL, cannot resolve `../chat-tools.ts`.

- [ ] **Step 3: Create `lib/mcp/chat-tools.ts`**

```ts
/**
 * The chat tools beyond post/dm/ack/claim/release (those stay in tools.ts).
 * Every tool acts only as this session: the handle comes from this
 * session's file and the session id from the server's environment, never
 * from input. No import of commands/chat.ts (TUI-adjacent).
 */
import {
  chatArchive, chatAway, chatBack, chatBuddies, chatInvite, chatJoin, chatLeave, chatMark, chatMessages,
  chatRead, chatRooms, chatSignOut, chatWho, getSetting,
} from "../../packages/rt-client/src/index.ts";
import type { Commands } from "../../packages/rt-client/src/index.ts";
import { existsSync, statSync } from "fs";
import { isAbsolute } from "path";
import { deleteChatSession, readChatSession, type ChatSession } from "../chat-session.ts";
import { inboxAlive, resolveInbox } from "../claude-registry.ts";
import { parseDuration } from "../duration.ts";
import { selfPaneRef } from "../self-pane.ts";
import { spawnRtJson, type RtVerbResult } from "./rt-verb.ts";
import { checkChatName, checkOptional, checkRequired, err, fromResponse, ok, requireChatHandle, type McpToolDef } from "./shared.ts";

export interface ChatToolDeps {
  read: typeof chatRead; messages: typeof chatMessages; mark: typeof chatMark; rooms: typeof chatRooms;
  who: typeof chatWho; buddies: typeof chatBuddies; join: typeof chatJoin; leave: typeof chatLeave;
  away: typeof chatAway; back: typeof chatBack;
  signOut: typeof chatSignOut; archive: typeof chatArchive; invite: typeof chatInvite;
  session: (id: string | undefined) => ChatSession | null;
  deleteSession: (id: string) => void;
  spawnRt: (path: string[], rest: string[], opts: { cwd?: string; timeoutMs?: number }) => Promise<RtVerbResult>;
  isDir: (path: string) => boolean;
  serverCwd: () => string | undefined;
  humanHandle: () => string | undefined;
  sessionAlive: (id: string) => boolean;
  now: () => number;
}

export const realChatToolDeps: ChatToolDeps = {
  read: chatRead, messages: chatMessages, mark: chatMark, rooms: chatRooms, who: chatWho, buddies: chatBuddies,
  join: chatJoin, leave: chatLeave, away: chatAway, back: chatBack, signOut: chatSignOut, archive: chatArchive, invite: chatInvite,
  session: readChatSession,
  deleteSession: deleteChatSession,
  spawnRt: (path, rest, opts) => spawnRtJson(path, rest, opts),
  isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
  serverCwd: () => {
    try {
      return process.cwd();
    } catch {
      return undefined;
    }
  },
  humanHandle: () => {
    try {
      const v = getSetting<string>("chat.humanHandle").value;
      return typeof v === "string" && v ? v : undefined;
    } catch {
      return undefined;
    }
  },
  sessionAlive: (id) => {
    const binding = resolveInbox(id);
    return binding !== null && inboxAlive(binding);
  },
  now: () => Date.now(),
};

const NO_SESSION = "CLAUDE_CODE_SESSION_ID is not set; this tool runs inside a Claude Code session";
const ROOM_PROP = { room: { type: "string", description: "Room name (lowercase letters, digits, . _ -)." } };

function checkPositiveInt(input: Record<string, unknown>, name: string): string | undefined {
  const v = input[name];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return `"${name}" must be a positive integer`;
  return undefined;
}

function checkCwd(input: Record<string, unknown>, isDir: (p: string) => boolean): string | undefined {
  const v = input.cwd;
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !isAbsolute(v) || !isDir(v)) return '"cwd" must be an absolute path to an existing directory';
  return undefined;
}

export function chatToolDefs(deps: ChatToolDeps = realChatToolDeps): McpToolDef[] {
  const handleOf = (env: NodeJS.ProcessEnv) => requireChatHandle(env, deps.session);
  return [
    {
      name: "chat_read",
      description: "Read unread chat messages as this session's handle (every room, or one), advancing this handle's read cursor. since (30s, 5m, 500ms, bare seconds) peeks without advancing; last returns a room's newest N regardless of the cursor, then marks it read.",
      inputSchema: { type: "object", properties: { ...ROOM_PROP, limit: { type: "number" }, since: { type: "string" }, last: { type: "number" } }, additionalProperties: false },
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkOptional(input, [{ name: "room", type: "string" }, { name: "since", type: "string" }]) ?? checkPositiveInt(input, "limit") ?? checkPositiveInt(input, "last")
          ?? (input.room !== undefined ? checkChatName("room", input.room) : undefined);
        if (bad) return err(bad);
        const room = input.room as string | undefined;
        if (input.last !== undefined) {
          if (input.since !== undefined) return err("last and since are mutually exclusive");
          if (!room) return err("last needs a room");
          const page = await deps.messages({ room, limit: input.last as number });
          if (!page.ok) return fromResponse(page);
          const marked = await deps.mark({ handle: id.handle, room });
          if (!marked.ok) return fromResponse(marked);
          return ok({ rooms: [{ room, messages: page.data?.messages ?? [] }] });
        }
        let sinceMs: number | undefined;
        if (typeof input.since === "string") {
          const ms = parseDuration(input.since);
          if (ms == null) return err(`"since" is not a duration (use 30s, 5m, 500ms, or bare seconds): ${JSON.stringify(input.since)}`);
          sinceMs = deps.now() - ms;
        }
        const payload: Commands["chat:read"]["payload"] = { handle: id.handle, limit: (input.limit as number | undefined) ?? 20 };
        if (room) payload.room = room;
        if (sinceMs !== undefined) payload.sinceMs = sinceMs;
        const res = await deps.read(payload);
        return res.ok ? ok({ rooms: res.data?.rooms ?? [] }) : fromResponse(res);
      },
    },
    {
      name: "chat_mark",
      description: "Mark chat messages read for this session's handle: every open room, one room, or one room up to a message id (upto).",
      inputSchema: { type: "object", properties: { ...ROOM_PROP, upto: { type: "number" } }, additionalProperties: false },
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = (input.room !== undefined ? checkChatName("room", input.room) : undefined) ?? checkPositiveInt(input, "upto");
        if (bad) return err(bad);
        if (input.upto !== undefined && input.room === undefined) return err("upto needs a room");
        const payload: Commands["chat:mark"]["payload"] = { handle: id.handle };
        if (typeof input.room === "string") payload.room = input.room;
        if (typeof input.upto === "number") payload.upto = input.upto;
        return fromResponse(await deps.mark(payload));
      },
    },
    {
      name: "chat_rooms",
      description: "List the chat rooms this session's handle belongs to, with unread counts.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async handler(_input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        return fromResponse(await deps.rooms({ handle: id.handle }));
      },
    },
    {
      name: "chat_who",
      description: "List a chat room's members with their presence status.",
      inputSchema: { type: "object", properties: { ...ROOM_PROP }, required: ["room"], additionalProperties: false },
      async handler(input) {
        const bad = checkChatName("room", input.room);
        if (bad) return err(bad);
        const res = await deps.who({ room: input.room as string });
        return res.ok ? ok({ rooms: [{ room: input.room, members: res.data?.members ?? [] }] }) : fromResponse(res);
      },
    },
    {
      name: "chat_buddies",
      description: "List every chat handle on this machine with its presence status (live, idle, away, offline).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async handler() {
        return fromResponse(await deps.buddies());
      },
    },
    {
      name: "chat_join",
      description: "Join a chat room as this session's handle. wakeOn (mention, all, none) sets when a message is delivered; cwd is the checkout this session works in (the server's own directory is fixed at session start).",
      inputSchema: { type: "object", properties: { ...ROOM_PROP, wakeOn: { type: "string", enum: ["mention", "all", "none"] }, cwd: { type: "string" } }, required: ["room"], additionalProperties: false },
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkChatName("room", input.room) ?? checkCwd(input, deps.isDir);
        if (bad) return err(bad);
        if (input.wakeOn !== undefined && input.wakeOn !== "mention" && input.wakeOn !== "all" && input.wakeOn !== "none") return err('"wakeOn" must be mention, all or none');
        const room = input.room as string;
        const payload: Commands["chat:join"]["payload"] = { room, handle: id.handle };
        if (input.wakeOn !== undefined) payload.wakeOn = input.wakeOn as "mention" | "all" | "none";
        const cwd = (input.cwd as string | undefined) ?? deps.serverCwd();
        if (cwd) payload.cwd = cwd;
        const pane = selfPaneRef(env);
        if (pane) payload.pane = pane;
        const res = await deps.join(payload);
        return res.ok ? ok({ room, ...res.data }) : fromResponse(res);
      },
    },
    {
      name: "chat_leave",
      description: "Leave a chat room as this session's handle.",
      inputSchema: { type: "object", properties: { ...ROOM_PROP }, required: ["room"], additionalProperties: false },
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkChatName("room", input.room);
        if (bad) return err(bad);
        return fromResponse(await deps.leave({ room: input.room as string, handle: id.handle }));
      },
    },
    {
      name: "chat_away",
      description: "Set an away message on this session's chat presence without signing out; chat_back clears it.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
      async handler(input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (!sessionId) return err(NO_SESSION);
        const bad = checkRequired(input, [{ name: "text", type: "string" }]);
        if (bad) return err(bad);
        if ((input.text as string).trim() === "") return err('"text" must not be empty');
        return fromResponse(await deps.away({ sessionId, text: input.text as string }));
      },
    },
    {
      name: "chat_back",
      description: "Clear this session's chat away message.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async handler(_input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (!sessionId) return err(NO_SESSION);
        return fromResponse(await deps.back({ sessionId }));
      },
    },
  ];
}
```

Notes for the implementer:
- `getSetting` must be exported from `packages/rt-client/src/index.ts` (it is, line 157). If `tsc` rejects the generic form, use `getSetting("chat.humanHandle").value` with a `typeof` check.
- `fromResponse(res)` on an ok response with `data: {}` yields `{ ok: true, body: {} }`, which the mark test expects.
- `NO_SESSION` and `checkCwd` are used again in Task 5.

- [ ] **Step 4: Wire the roster**

In `lib/mcp/tools.ts` add `import { chatToolDefs } from "./chat-tools.ts";` beside the other `*-tools.ts` imports, and add `...chatToolDefs(),` as the last element after `...herdToolDefs(),`.

In `lib/mcp/__tests__/tools.test.ts`, append to the end of `NAMES`:
`"chat_read","chat_mark","chat_rooms","chat_who","chat_buddies","chat_join","chat_leave","chat_away","chat_back"`.

In `e2e/tests/mcp-serve.test.ts`, append a new line to `EXPECTED_TOOL_NAMES`:
`"chat_read", "chat_mark", "chat_rooms", "chat_who", "chat_buddies", "chat_join", "chat_leave", "chat_away", "chat_back",`
and append the same nine names to the end of `PUBLISHED`.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/mcp`
Expected: PASS.

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/chat-tools.ts lib/mcp/__tests__/chat-tools.test.ts lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts e2e/tests/mcp-serve.test.ts
git commit -m "mcp: chat read, mark, rooms, who, buddies, join, leave, away and back tools"
```

---

### Task 5: chat_sign_in and chat_sign_out

**Files:**
- Modify: `lib/mcp/chat-tools.ts` (append two tools to the returned array)
- Modify: `lib/mcp/__tests__/chat-tools.test.ts`
- Modify: `lib/mcp/__tests__/tools.test.ts` (`NAMES`), `e2e/tests/mcp-serve.test.ts` (`EXPECTED_TOOL_NAMES`, `PUBLISHED`)

**Interfaces:**
- Consumes: `deps.spawnRt`, `deps.isDir`, `deps.humanHandle`, `deps.sessionAlive`, `deps.signOut`, `deps.deleteSession`, `deps.session`; `NO_SESSION`, `checkCwd`, `checkChatName` (Tasks 3 and 4).
- Produces: tools `chat_sign_in` (input `cwd?`, `as?`, `room?`, `noRoom?`, `status?`; body `{ handle, room }`) and `chat_sign_out` (no input; body `{}` or `{ daemonError }`).

- [ ] **Step 1: Append failing tests to `lib/mcp/__tests__/chat-tools.test.ts`**

```ts
describe("chat_sign_in", () => {
  test("spawns the CLI with a fixed argv built from named inputs, in the given cwd", async () => {
    const f = fake();
    const r = await f.tool("chat_sign_in").handler({ cwd: "/work", as: "ann", room: "build", status: "rebasing" }, ENV);
    expect(r).toEqual({ ok: true, body: { handle: "ann", room: "rt" } });
    expect(f.calls).toEqual([{
      fn: "spawnRt",
      a: { path: ["chat", "sign-in"], rest: ["--session", "s1", "--as", "ann", "--room", "build", "--status", "rebasing"] },
      o: { cwd: "/work" },
    }]);
  });

  test("noRoom passes --no-room; no cwd runs in the server's directory", async () => {
    const f = fake();
    await f.tool("chat_sign_in").handler({ noRoom: true }, ENV);
    expect(f.calls[0]!.a.rest).toEqual(["--session", "s1", "--no-room"]);
    expect(f.calls[0]!.o).toEqual({});
  });

  test("never passes --pane, even when input names one", async () => {
    const f = fake();
    await f.tool("chat_sign_in").handler({ pane: "w9:p9", session: "other" }, ENV);
    expect(f.calls[0]!.a.rest).toEqual(["--session", "s1"]);
  });

  test.each([
    [{ room: "build", noRoom: true }],
    [{ cwd: "relative" }],
    [{ cwd: "/missing" }],
    [{ as: "--pane" }],
    [{ status: "-x" }],
    [{ as: "Bad Name" }],
    [{ room: "--no-room" }],
    [{ noRoom: "true" }],
    [{ as: "pat" }],
    [{ as: "here" }],
  ])("refuses %j with no spawn", async (input) => {
    const f = fake();
    const r = await f.tool("chat_sign_in").handler(input, ENV);
    expect(r.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("the human handle refusal follows the setting", async () => {
    const f = fake({ human: "robin" });
    expect((await f.tool("chat_sign_in").handler({ as: "robin" }, ENV)).ok).toBe(false);
    expect((await f.tool("chat_sign_in").handler({ as: "pat" }, ENV)).ok).toBe(true);
  });

  test("a replaced or dead session is refused with the Bash pointer and no spawn", async () => {
    const f = fake({ alive: false });
    const r = await f.tool("chat_sign_in").handler({}, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rt chat sign-in");
    expect(f.calls).toEqual([]);
  });

  test("refuses without a session id", async () => {
    const f = fake();
    expect((await f.tool("chat_sign_in").handler({}, {} as NodeJS.ProcessEnv)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("a CLI failure comes back as the tool error", async () => {
    const f = fake({ spawn: { ok: false, error: "rt daemon unreachable" } });
    const r = await f.tool("chat_sign_in").handler({}, ENV);
    expect(r).toEqual({ ok: false, body: undefined, error: "rt daemon unreachable" });
  });
});

describe("chat_sign_out", () => {
  test("signs out the env session and deletes its file", async () => {
    const f = fake();
    const r = await f.tool("chat_sign_out").handler({}, ENV);
    expect(r).toEqual({ ok: true, body: {} });
    expect(f.calls).toEqual([
      { fn: "signOut", a: { sessionId: "s1" }, o: { timeoutMs: 3000 } },
      { fn: "deleteSession", a: "s1" },
    ]);
  });

  test("deletes the file even when the daemon fails, reporting daemonError", async () => {
    const f = fake({ fail: "rt daemon unreachable" });
    const r = await f.tool("chat_sign_out").handler({}, ENV);
    expect(r).toEqual({ ok: true, body: { daemonError: "rt daemon unreachable" } });
    expect(f.calls.map((c) => c.fn)).toEqual(["signOut", "deleteSession"]);
  });

  test("refuses without a session id", async () => {
    const f = fake();
    expect((await f.tool("chat_sign_out").handler({}, {} as NodeJS.ProcessEnv)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/mcp/__tests__/chat-tools.test.ts`
Expected: FAIL, `chat_sign_in` is undefined.

- [ ] **Step 3: Add the tools**

Add near the top of `lib/mcp/chat-tools.ts`:

```ts
const REPLACED = "this session was replaced (/clear) or has ended, so chat_sign_in would sign in a session nothing receives for; run `rt chat sign-in` in Bash";
/** The reserved mention every human post carries (chat:post adds it for the human handle). */
const RESERVED_HANDLES = ["here"];
const SIGN_OUT_TIMEOUT_MS = 3000;

function flagValueError(name: string, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v === "") return `"${name}" must be a non-empty string`;
  if (v.startsWith("-")) return `"${name}" must not start with "-"`;
  return undefined;
}
```

Append to the array `chatToolDefs` returns:

```ts
    {
      name: "chat_sign_in",
      description: "Sign this session in to rt chat (presence, a handle, and the repo room derived from cwd unless room or noRoom says otherwise). cwd is the checkout this session works in; the server's own directory is fixed at session start. as picks this session's base handle and may not be the human's handle. After a /clear this tool refuses; run `rt chat sign-in` in Bash instead.",
      inputSchema: {
        type: "object",
        properties: { cwd: { type: "string" }, as: { type: "string" }, room: { type: "string" }, noRoom: { type: "boolean" }, status: { type: "string" } },
        additionalProperties: false,
      },
      async handler(input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (!sessionId) return err(NO_SESSION);
        const bad = checkOptional(input, [{ name: "noRoom", type: "boolean" }])
          ?? flagValueError("as", input.as) ?? flagValueError("room", input.room) ?? flagValueError("status", input.status)
          ?? (input.as !== undefined ? checkChatName("as", input.as) : undefined)
          ?? (input.room !== undefined ? checkChatName("room", input.room) : undefined)
          ?? checkCwd(input, deps.isDir);
        if (bad) return err(bad);
        if (input.room !== undefined && input.noRoom === true) return err("room and noRoom are mutually exclusive");
        if (typeof input.as === "string" && (input.as === deps.humanHandle() || RESERVED_HANDLES.includes(input.as))) {
          return err(`"as" may not be ${JSON.stringify(input.as)}: that handle speaks for the human`);
        }
        if (!deps.sessionAlive(sessionId)) return err(REPLACED);
        const rest = ["--session", sessionId];
        if (typeof input.as === "string") rest.push("--as", input.as);
        if (typeof input.room === "string") rest.push("--room", input.room);
        if (input.noRoom === true) rest.push("--no-room");
        if (typeof input.status === "string") rest.push("--status", input.status);
        const r = await deps.spawnRt(["chat", "sign-in"], rest, typeof input.cwd === "string" ? { cwd: input.cwd } : {});
        if (!r.ok) return err(r.error);
        const body = r.body as { handle?: unknown; room?: unknown };
        return ok({ handle: body.handle, room: body.room ?? null });
      },
    },
    {
      name: "chat_sign_out",
      description: "Sign this session out of rt chat: drop its presence and delete its session file. Room memberships are kept.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async handler(_input, env) {
        const sessionId = env.CLAUDE_CODE_SESSION_ID;
        if (!sessionId) return err(NO_SESSION);
        const res = await deps.signOut({ sessionId }, { timeoutMs: SIGN_OUT_TIMEOUT_MS });
        // Local cleanup runs whatever the daemon said, as the CLI's sign-out does: a stranded file keeps resolving to a dead handle.
        deps.deleteSession(sessionId);
        return ok(res.ok ? {} : { daemonError: res.error ?? "sign-out failed" });
      },
    },
```

Note the status value can contain spaces; it is one argv element, so no quoting is needed. `status` is exempt from the chat-name check (free text) but not from the leading-`-` or control-character refusals (`spawnRtJson` refuses control characters).

Note: `deleteSession` for an invalid session id is already a no-op inside `deleteChatSession`.

- [ ] **Step 4: Append the names**

`NAMES` (tools.test.ts): append `"chat_sign_in","chat_sign_out"`.
`EXPECTED_TOOL_NAMES` and `PUBLISHED` (mcp-serve.test.ts): append `"chat_sign_in", "chat_sign_out"`.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/mcp`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/chat-tools.ts lib/mcp/__tests__/chat-tools.test.ts lib/mcp/__tests__/tools.test.ts e2e/tests/mcp-serve.test.ts
git commit -m "mcp: chat_sign_in and chat_sign_out tools"
```

---

### Task 6: chat_archive and chat_invite

**Files:**
- Modify: `lib/mcp/chat-tools.ts`
- Modify: `lib/mcp/__tests__/chat-tools.test.ts`
- Modify: `lib/mcp/__tests__/tools.test.ts` (`NAMES`), `e2e/tests/mcp-serve.test.ts`

**Interfaces:**
- Consumes: `deps.who`, `deps.archive`, `deps.invite`, `handleOf`, `checkChatName`.
- Produces: tools `chat_archive` (input `room`, `reopen?`; body `{ room, archivedAt }`) and `chat_invite` (input `pane`, `room`, `note?`; body is the daemon's `InviteResult`).

- [ ] **Step 1: Append failing tests**

```ts
describe("chat_archive", () => {
  test("a member archives; reopen clears it", async () => {
    const f = fake();
    expect(await f.tool("chat_archive").handler({ room: "build" }, ENV)).toEqual({ ok: true, body: { room: "build", archivedAt: 5 } });
    await f.tool("chat_archive").handler({ room: "build", reopen: true }, ENV);
    expect(f.calls.filter((c) => c.fn === "archive").map((c) => c.a)).toEqual([
      { room: "build", handle: "ann", archived: true },
      { room: "build", handle: "ann", archived: false },
    ]);
  });

  test("a non-member is refused before the archive call", async () => {
    const f = fake({ who: { members: [{ room: "build", handle: "bob" }] } });
    const r = await f.tool("chat_archive").handler({ room: "build" }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not a member");
    expect(f.calls.map((c) => c.fn)).toEqual(["who"]);
  });

  test("unsigned, a bad room and a non-boolean reopen are refused", async () => {
    expect((await fake({ signedIn: false }).tool("chat_archive").handler({ room: "build" }, ENV)).ok).toBe(false);
    for (const input of [{ room: "Bad" }, { room: "build", reopen: "yes" }]) {
      const f = fake();
      expect((await f.tool("chat_archive").handler(input, ENV)).ok, JSON.stringify(input)).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });
});

describe("chat_invite", () => {
  test("sends the session handle as from and the server's pane as callerPane", async () => {
    const f = fake();
    const r = await f.tool("chat_invite").handler({ pane: "w2:p1", room: "build", note: "you own the vite side" }, ENV);
    expect(r).toEqual({ ok: true, body: { delivered: "accepted", paneId: "w2:p1" } });
    expect(f.calls[0]!.a).toEqual({ paneId: "w2:p1", room: "build", from: "ann", note: "you own the vite side", callerPane: "w1:p2" });
  });

  test("a note with a newline is allowed (the daemon folds it)", async () => {
    const f = fake();
    expect((await f.tool("chat_invite").handler({ pane: "w2:p1", room: "build", note: "line one\nline two" }, ENV)).ok).toBe(true);
  });

  test("refuses an unsigned session instead of speaking as the human", async () => {
    const f = fake({ signedIn: false });
    const r = await f.tool("chat_invite").handler({ pane: "w2:p1", room: "build" }, ENV);
    expect(r.error).toBe(SIGN_IN_HINT);
    expect(f.calls).toEqual([]);
  });

  test.each([
    [{ pane: "w2:p1", room: "build", note: "hi\u001b[2J" }],
    [{ pane: "w2:p1", room: "build", note: "stop\u0003" }],
    [{ pane: "w2:p1", room: "build", note: "a\tb" }],
    [{ pane: "w2:p1", room: "build", note: "a\u007fb" }],
    [{ pane: "w2:p1", room: "build", note: "x".repeat(301) }],
    [{ pane: "-w2", room: "build" }],
    [{ pane: "w2 p1", room: "build" }],
    [{ pane: "w2:p1", room: "Bad" }],
    [{ room: "build" }],
    [{ pane: "w2:p1" }],
  ])("refuses %j with no daemon call", async (input) => {
    const f = fake();
    expect((await f.tool("chat_invite").handler(input, ENV)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  test("a bg pane ref passes the shape check", async () => {
    const f = fake();
    expect((await f.tool("chat_invite").handler({ pane: "bg:w2:p1", room: "build" }, ENV)).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/mcp/__tests__/chat-tools.test.ts`
Expected: FAIL, `chat_archive` is undefined.

- [ ] **Step 3: Add the tools**

Near the top of `lib/mcp/chat-tools.ts`:

```ts
const PANE_REF = /^[A-Za-z0-9._:][A-Za-z0-9._:-]*$/;
const NOTE_MAX = 300;
/** Newlines are allowed because the daemon's inviteText folds them to spaces; every other C0 byte or DEL would reach the target pane as a keystroke. */
const NOTE_CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;
```

Append to the array:

```ts
    {
      name: "chat_archive",
      description: "Archive a chat room this session's handle belongs to (hidden from every member's room list until someone posts into it), or reopen it with reopen: true.",
      inputSchema: { type: "object", properties: { ...ROOM_PROP, reopen: { type: "boolean" } }, required: ["room"], additionalProperties: false },
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkChatName("room", input.room) ?? checkOptional(input, [{ name: "reopen", type: "boolean" }]);
        if (bad) return err(bad);
        const room = input.room as string;
        // The daemon checks no membership, and archiving hides the room from everyone in it.
        const who = await deps.who({ room });
        if (!who.ok) return fromResponse(who);
        if (!(who.data?.members ?? []).some((m) => m.handle === id.handle)) return err(`${id.handle} is not a member of #${room}; only a member may archive or reopen it`);
        const res = await deps.archive({ room, handle: id.handle, archived: input.reopen !== true });
        return res.ok ? ok({ room: res.data?.room ?? room, archivedAt: res.data?.archivedAt ?? null }) : fromResponse(res);
      },
    },
    {
      name: "chat_invite",
      description: "Invite another herdr pane into a chat room: types /chat:join <room> (with an optional one-line note from this session's handle) into that pane. pane is a herdr pane id or ref; note is at most 300 characters with no control characters.",
      inputSchema: { type: "object", properties: { pane: { type: "string" }, ...ROOM_PROP, note: { type: "string" } }, required: ["pane", "room"], additionalProperties: false },
      async handler(input, env) {
        const id = handleOf(env);
        if ("error" in id) return err(id.error);
        const bad = checkRequired(input, [{ name: "pane", type: "string" }]) ?? checkChatName("room", input.room) ?? checkOptional(input, [{ name: "note", type: "string" }]);
        if (bad) return err(bad);
        if (!PANE_REF.test(input.pane as string)) return err('"pane" must be a herdr pane id or ref (letters, digits, . _ : -, not starting with -)');
        if (typeof input.note === "string") {
          if (NOTE_CONTROL.test(input.note)) return err('"note" must not contain control characters');
          if (input.note.length > NOTE_MAX) return err(`"note" must be at most ${NOTE_MAX} characters`);
        }
        const payload: Commands["chat:invite"]["payload"] = { paneId: input.pane as string, room: input.room as string, from: id.handle };
        if (typeof input.note === "string") payload.note = input.note;
        const callerPane = selfPaneRef(env);
        if (callerPane) payload.callerPane = callerPane;
        return fromResponse(await deps.invite(payload));
      },
    },
```

Check the payload key order in the invite test: `toEqual` ignores key order, so building `note` before `callerPane` is fine.

- [ ] **Step 4: Append the names**

`NAMES`: append `"chat_archive","chat_invite"`. `EXPECTED_TOOL_NAMES` and `PUBLISHED`: append `"chat_archive", "chat_invite"`.

- [ ] **Step 5: Run the tests**

Run: `bun test lib/mcp`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/chat-tools.ts lib/mcp/__tests__/chat-tools.test.ts lib/mcp/__tests__/tools.test.ts e2e/tests/mcp-serve.test.ts
git commit -m "mcp: chat_archive (members only) and chat_invite tools"
```

---

### Task 7: Full verification

**Files:** none new; fixes only if a gate fails.

- [ ] **Step 1: Unit gates**

Run each as its own command:
- `bun test lib/mcp lib/__tests__/agent-safe.test.ts lib/__tests__/duration.test.ts lib/__tests__/events-cli.test.ts`: PASS.
- `bun run test`: PASS (redirect to a file in the scratchpad and grep for `fail` if the output is long).
- `bunx tsc --noEmit`: no errors.
- `bun run picker:check`: passes (no command-tree change is expected).

- [ ] **Step 2: Purity gate**

Run `git add -A` then `bash scripts/repo-purity.sh`. Expected: passes. Also run `git grep -n -e $'—' -e $'–' -- lib/mcp lib/duration.ts lib/__tests__/duration.test.ts docs/superpowers` (em dash U+2014, en dash U+2013) and expect no hits in files this branch touched.

- [ ] **Step 3: e2e against a freshly built dist/rt**

Build `dist/rt` with the repo's build script (read `package.json` for the `build` script name; the e2e harness reads `dist/rt`), then run `bun test --preload ./e2e/setup.ts e2e/tests/mcp-serve.test.ts`. Expected: PASS, with the 13 new names in `tools/list`.

- [ ] **Step 4: Commit any fixes**

```bash
git commit -m "mcp: chat tools verification fixes"
```
(Only if Steps 1-3 needed changes.)
