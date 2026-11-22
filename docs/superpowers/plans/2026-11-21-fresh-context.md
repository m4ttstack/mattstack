# fresh-context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `fresh_context` tool and `/fresh` command (a new mod) that clear or compact a session and replay a caller's ledger, plus an rt chat hand-off that keeps a signed-in session's identity live across a `/clear`.

**Architecture:** rt gains a kv-backed hand-off record (`lib/state/chat-handoff.ts`), three daemon commands and a hidden `rt chat handoff begin|complete|cancel` CLI verb. The presence roster, the prune sweep and `chat:sign-out` read the record. The mod (`mods/fresh-context`) registers the tool and command, saves a carry file, runs the reset after the turn ends, and drives the CLI verb around it.

**Tech Stack:** Bun, TypeScript, bun:sqlite (state.db kv), Claude Code mods API (2.1.330), `@mattstack/mod-kit`, `claude-code/testing`.

**Spec:** `docs/superpowers/specs/2026-11-21-fresh-context-design.md`

## Global Constraints

- No timer decides anything in the hand-off; every ending is an event (spec, "Anti-goals").
- The hand-off verb is CLI only: no MCP tool, no `rt_verb` exposure (spec, "Anti-goals").
- Default behaviour is untouched: a plain `/clear`, `/compact` or exit signs out exactly as today.
- The mod never decides what a ledger contains; it carries free text.
- No `SCHEMA_VERSION` bump: the hand-off lives in state.db's kv (`getKvValue`/`setKvValue`, `lib/state/kv-blob.ts`).
- Everything rt prints goes through `lib/ui/out.ts`; the new verb writes `--json` through `out.json` and refusals as `refused` notes (`.claude/rules/output-layer.md`).
- Tests run from the repo root (`bunfig.toml` preload). Daemon tests use a temp state.db (`openStateDb(join(tmpdir(), ...))`), never the real one.
- Clean-code comments only: a comment states a constraint the code cannot show.
- The pr-usher and `matt:self-compact` skill edits are out of this plan.

## Review Focus

1. **The session exits (not clears) while a hand-off is pending.** Expect a normal sign-out: the mod cancels, and cancel signs the old row out when its session is no longer the pid's current one. Pinned in Task 1 (`cancel after the session moved on signs the row out`) and Task 6.
2. **The mod never completes** (crash between clear and complete, rt call fails). Expect the row to read offline once the pid names a third session or a session that signed in on its own. Pinned in Task 1 (`settle ends the hand-off ...`).
3. **A DM sent during the reset.** Expect it in Complete's welcome catch-up, not lost. Pinned in Task 3 (`complete delivers a welcome with the catch-up`) and checked live in Task 9.
4. **Another session calls complete** for an identity it doesn't own. Expect a refusal. Pinned in Task 1 (`complete refuses a session the pid does not name`).
5. **Background work starts in the same turn as the tool call.** Expect the reset to be abandoned at turn end with a notice, and the hand-off cancelled. Pinned in Task 6 (`a background shell at turn end abandons the reset`).

---

### Task 1: The hand-off record

**Files:**
- Create: `lib/state/chat-handoff.ts`
- Test: `lib/state/__tests__/chat-handoff.test.ts`

**Interfaces:**
- Consumes: `getKvValue`, `setKvValue` (`lib/state/kv-blob.ts`); `presenceForSession`, `signOut` (`lib/state/presence-store.ts`); `bindIdentitySession` (`lib/state/identity-store.ts`); `sessionForPid` (`lib/claude-registry.ts`).
- Produces:
  ```ts
  export interface Handoff { handle: string; fromSessionId: string; pid: number; nextSessionId?: string; startedAt: number }
  export interface HandoffDeps { sessionForPid(pid: number): string | null; pidAlive(pid: number): boolean }
  export const defaultHandoffDeps: HandoffDeps
  export type HandoffRefusal = { refused: "not-signed-in" | "already-handing-off" | "no-handoff" | "not-this-session" }
  export function beginHandoff(a: { sessionId: string; pid: number; now?: number }, db?: Database): Handoff | HandoffRefusal
  export function completeHandoff(a: { fromSessionId: string; sessionId: string }, db?: Database, deps?: HandoffDeps): { handle: string } | HandoffRefusal
  export function cancelHandoff(a: { fromSessionId: string }, db?: Database, deps?: HandoffDeps): { signedOut: boolean } | HandoffRefusal
  export function handoffFromSession(sessionId: string, db?: Database): Handoff | null
  export function pendingHandoffFor(handle: string, db?: Database, deps?: HandoffDeps): Handoff | null
  ```

One kv key per identity, `chat.handoff.<handle>`, holding the `Handoff` JSON; `handoffFromSession` scans by `fromSessionId` (a kv prefix read).

`pendingHandoffFor` settles the record before answering, and deletes it (signing the old row out) when it has ended:
- pid dead → ended.
- `sessionForPid(pid)` is `fromSessionId` → pending.
- it names a new id and `nextSessionId` is unset → record it as `nextSessionId`, pending.
- it names an id other than `nextSessionId`, or `nextSessionId` already has its own presence row → ended.

`completeHandoff` refuses unless a record exists from `fromSessionId` and `sessionForPid(pid) === sessionId`. It then moves the presence row and the identity to `sessionId` (update `chat_presence.session_id`, `bindIdentitySession(handle, sessionId)`) and deletes the record. Rooms and Slack conversations key on the handle, so they move with it.

`cancelHandoff` deletes the record; when `sessionForPid(pid) !== fromSessionId` the old session already ended, so it also calls `signOut(fromSessionId)` and returns `{ signedOut: true }`.

- [ ] **Step 1: Write the failing tests** (fake `HandoffDeps`, temp db, a presence row from `signIn`):
  - `begin refuses a session that is not signed in` → `{ refused: "not-signed-in" }`
  - `begin twice refuses the second` → `{ refused: "already-handing-off" }`
  - `complete moves the row and identity to the new session`: after begin, `sessionForPid` returns `"new"`; `completeHandoff({ fromSessionId: "old", sessionId: "new" })` → `{ handle }`; `presenceForSession("new")?.handle === handle`; `presenceForSession("old") === null`; `handoffFromSession("old") === null`
  - `complete refuses a session the pid does not name` → `{ refused: "not-this-session" }`
  - `cancel before the clear leaves the row signed in` → `{ signedOut: false }`, row has no `signedOutAt`
  - `cancel after the session moved on signs the row out` → `{ signedOut: true }`, row has `signedOutAt`
  - `settle ends the hand-off when the pid dies`, `... names a third session`, `... when the next session signed in on its own` → `pendingHandoffFor(handle) === null` and old row signed out
  - `settle keeps a hand-off whose pid moved to its first new session` → returns the record with `nextSessionId` set
- [ ] **Step 2: Run them to see them fail**
  Run: `bun test lib/state/__tests__/chat-handoff.test.ts`
  Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/state/chat-handoff.ts`** with the signatures above. `defaultHandoffDeps.pidAlive` uses `process.kill(pid, 0)` like `inboxAlive`.
- [ ] **Step 4: Run them to see them pass**
  Run: `bun test lib/state/__tests__/chat-handoff.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "chat: add the hand-off record for a session that clears itself"`

### Task 2: The roster, the prune sweep and sign-out respect a pending hand-off

**Files:**
- Modify: `lib/state/presence-store.ts` (`buddyStatus`, `prunePresence`)
- Modify: `lib/daemon/handlers/chat.ts` (`"chat:sign-out"` handler, ~line 1427)
- Test: `lib/state/__tests__/presence-store.test.ts`, `lib/daemon/__tests__/chat-handoff-signout.test.ts`

**Interfaces:**
- Consumes: `pendingHandoffFor`, `handoffFromSession`, `HandoffDeps` (Task 1).
- Produces: `buddyStatus(row, now, th?, deps?, handoffDeps?)` where `row` now also picks `handle`; behaviour below. No new exports.

Rules:
- `buddyStatus`: when the row is not signed out, has a handle, the registry has nothing alive for its session id, and `pendingHandoffFor(handle)` returns a record → `"idle"`.
- `prunePresence`: skip a candidate whose handle has a pending hand-off.
- `chat:sign-out`: when `handoffFromSession(sessionId)` is pending, delete the local session file and return `{ ok: true, data: { sessionId } }` without `signOut` and without `finishClose`.

- [ ] **Step 1: Write the failing tests**
  - presence: `a row handing off reads idle while the registry has moved on`; `prune spares a row handing off`
  - daemon: `sign-out of a session handing off keeps the row signed in` (row has no `signedOutAt`); `sign-out of a session handing off does not close its Slack chat` (`conversationForAgent(handle)` still open); `sign-out with no hand-off still signs out`
- [ ] **Step 2: Run them to see them fail**
  Run: `bun test lib/state/__tests__/presence-store.test.ts lib/daemon/__tests__/chat-handoff-signout.test.ts`
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement the three rules.** Thread `HandoffDeps` through `createChatHandlers`' existing deps object so tests can fake it.
- [ ] **Step 4: Run them to see them pass** (same command). Expected: PASS, existing tests in both files still PASS.
- [ ] **Step 5: Commit**
  `git commit -m "chat: a session handing off stays on the roster and keeps its Slack chat"`

### Task 3: Daemon commands and the welcome on complete

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (beside `"chat:sign-out"`, ~line 879)
- Modify: `packages/rt-client/src/client.ts`, `packages/rt-client/src/index.ts`
- Modify: `lib/daemon/handlers/chat.ts`
- Test: `lib/daemon/__tests__/chat-handoff.test.ts`

**Interfaces:**
- Consumes: Task 1's functions.
- Produces:
  ```ts
  "chat:handoff-begin":    { payload: { sessionId: string; pid: number }; data: { handle: string } }
  "chat:handoff-complete": { payload: { fromSessionId: string; sessionId: string }; data: { handle: string; name: string } }
  "chat:handoff-cancel":   { payload: { fromSessionId: string }; data: { signedOut: boolean } }
  export function chatHandoffBegin(a, o?), chatHandoffComplete(a, o?), chatHandoffCancel(a, o?)  // same shape as chatSignOut
  ```
  A refusal returns `{ ok: false, error, failure: { code: <the HandoffRefusal value>, message } }`.

Extract the welcome composition from the `"chat:sign-in"` handler (the block from `listRooms(data.handle, db)` to the `queueMicrotask`, ~lines 1395-1415) into `queueWelcome(sessionId: string, handle: string, name: string): void` inside `createChatHandlers`, and call it from sign-in and from `chat:handoff-complete`.

- [ ] **Step 1: Write the failing tests**
  - `begin then complete keeps the handle on the new session`
  - `complete delivers a welcome with the catch-up`: post a DM to the handle between begin and complete; the fake inbox for `"new"` receives one frame containing the DM body
  - `complete refuses another session` → `failure.code === "not-this-session"`
  - `cancel returns signedOut false before the clear`
- [ ] **Step 2: Run them to see them fail**
  Run: `bun test lib/daemon/__tests__/chat-handoff.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Add the three command types, client wrappers, handlers and `queueWelcome`.**
- [ ] **Step 4: Run them, plus the sign-in welcome tests, to see them pass**
  Run: `bun test lib/daemon/__tests__/chat-handoff.test.ts lib/daemon/__tests__/chat-delivery.test.ts lib/daemon/__tests__/chat-identity-incident.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "chat: daemon commands to begin, complete and cancel a hand-off"`

### Task 4: `rt chat handoff begin|complete|cancel`

**Files:**
- Create: `commands/chat-handoff.ts`
- Modify: `lib/command-tree-def.ts` (chat `subcommands`, beside `avatar`)
- Test: `commands/__tests__/chat-handoff.test.ts`

**Interfaces:**
- Consumes: Task 3's client wrappers.
- Produces: `export async function chatHandoff(args: string[]): Promise<void>`.
  - `rt chat handoff begin [--json]`: session from `CLAUDE_CODE_SESSION_ID`, pid from `CLAUDE_PID`.
  - `rt chat handoff complete --from <sessionId> [--json]`: new session from `CLAUDE_CODE_SESSION_ID`; on success also writes the local chat session file for the new session (the same writer `rt chat sign-in` uses, `lib/chat-session.ts`).
  - `rt chat handoff cancel --from <sessionId> [--json]`.
  - `--json` envelopes: `{ "ok": true, "handle": "..." }`, `{ "ok": true, "handle": "...", "name": "..." }`, `{ "ok": true, "signedOut": false }`; a refusal is `{ "ok": false, "code": "<refusal>", "error": "<message>" }` with exit 2.
  - Command tree entry: `hidden: true`, `module: "./commands/chat-handoff.ts"`, `fn: "chatHandoff"`, description `"Keep this session's chat name across a /clear"`.

- [ ] **Step 1: Write the failing tests** against a fake daemon socket (pattern: `commands/__tests__/chat.test.ts`): each verb's `--json` envelope; `begin` with no `CLAUDE_PID` fails with a usage failure naming `CLAUDE_PID`; a refusal prints the envelope and exits 2; `complete` writes the new session's chat session file.
- [ ] **Step 2: Run them to see them fail**
  Run: `bun test commands/__tests__/chat-handoff.test.ts`
  Expected: FAIL.
- [ ] **Step 3: Implement `chatHandoff` and the tree entry.**
- [ ] **Step 4: Run them, and the command-tree conformance, to see them pass**
  Run: `bun test commands/__tests__/chat-handoff.test.ts lib/__tests__/no-raw-output.test.ts && bun test lib/__tests__/command-tree*.test.ts`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "chat: add rt chat handoff for the fresh-context mod"`

### Task 5: Mod scaffold, carry file and busy check

**Files:**
- Create: `mods/fresh-context/{mod.json,package.json,tsconfig.json,README.md,LICENSE,types/index.d.ts}`
- Create: `mods/fresh-context/src/carry.ts`, `mods/fresh-context/src/busy.ts`
- Test: `mods/fresh-context/src/carry.test.ts`, `mods/fresh-context/src/busy.test.ts`
- Modify: `package.json` (`mods:typecheck` adds `bunx tsc -p mods/fresh-context`)

**Interfaces:**
- Produces:
  ```ts
  // carry.ts
  export type Mode = 'clear' | 'compact'
  export interface Carry { mode: Mode; ledger: string; then?: string; oldSessionId: string; chatHandle?: string; createdAt: number }
  export function carryPath(dataDir: string, sessionId: string): string          // <dataDir>/carry-<sessionId>.json
  export function parseCarry(text: string): Carry | null                         // null on bad JSON or missing fields
  export function ledgerMessage(ledger: string): string                          // the text appended to the fresh context
  // busy.ts
  export interface TaskLike { type: string; status: string; description?: string }
  export function busyTasks(agents: { id: string; description: string; status?: string }[], tasks: TaskLike[]): string[]  // one line per blocker
  ```
- `ledgerMessage` returns exactly: `"Ledger carried from before the reset:\n\n" + ledger`.
- `busyTasks` counts subagents that are still running and tasks of type `shell`, `monitor`, `subagent` or `workflow` whose status is running or pending; every other type (a wakeup, for one) is ignored. Each line is `"<type>: <description>"`.
- `mod.json`: name `fresh-context`, version `0.1.0`, description `"Clear or compact a session and pick up where it left off, keeping its rt chat name."`, author and license as `human-todos`, `"clients": []`, `"files": ["LICENSE", "README.md"]`.

- [ ] **Step 1: Write the failing tests**: `parseCarry` round-trips a carry and rejects `{}`; `ledgerMessage("x")` equals the exact string; `busyTasks` returns `["shell: npm run dev"]` for a running shell, `[]` for a task of type `wakeup`, and one line for a running subagent.
- [ ] **Step 2: Run them to see them fail**
  Run: `bun run mods:test`
  Expected: the new tests FAIL.
- [ ] **Step 3: Write the scaffold and the two modules.** README: what the tool and command do, the chat hand-off, and the busy rule, at least 40 words.
- [ ] **Step 4: Run tests and typecheck**
  Run: `bun run mods:test && bun run mods:typecheck`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "fresh-context: scaffold the mod, its carry file and busy check"`

### Task 6: The `fresh_context` tool, the reset and the hand-over

**Files:**
- Create: `mods/fresh-context/src/register.ts`, `src/tool.ts`, `src/reset.ts`, `src/chat.ts`
- Test: `mods/fresh-context/harness/tool.test.ts`, `harness/test-world.ts`

**Interfaces:**
- Consumes: Task 5's `Carry`, `carryPath`, `parseCarry`, `ledgerMessage`, `busyTasks`; Task 4's CLI verb.
- Produces: tool `mcp__fresh-context__fresh_context` with schema `{ mode: enum ['clear','compact'] (required), ledger: string (required), then: string }`, `isDeferred: false`, allowed at `tool.check` without a prompt.
  ```ts
  // chat.ts: each runs `rt chat handoff ... --json` with env from $.process.hookEnv()
  export async function beginChat($): Promise<string | null>            // the handle, or null when not signed in
  export async function completeChat($, fromSessionId: string): Promise<boolean>
  export async function cancelChat($, fromSessionId: string): Promise<void>
  ```

Flow (the spec's "What a call does", made exact):
1. `tool.run`: if `busyTasks($.agent.list(), lastStopTasks)` is non-empty and mode is `clear`, return `{ deny: "Not now: still running\n" + lines.join("\n") }`. `lastStopTasks` is the `background_tasks` of the most recent `classic.Stop`.
2. Write the carry (`$.fs.write(carryPath(CLAUDE_PLUGIN_DATA, sid), ...)`). In `clear` mode call `beginChat` and store the handle on the carry. `compact` keeps the session id, so it does no hand-off (Task 9 Step 4 confirms; if the id changes, compact takes the clear path's hand-off).
3. Return `{ text: "Reset queued: <mode> after this turn." }`.
4. `classic.Stop` with a pending carry: re-run `busyTasks` on this Stop's `background_tasks` (clear mode). If busy: `cancelChat`, delete the carry, `$.prompt.submit({ text: "fresh_context did not run: still running\n<lines>" })`. Otherwise `$.clock.after(0, ...)` runs `$.command.run({ command: "clear" })` or `$.session.compact({ instructions: carry.ledger })`.
5. `session.end` with `reason: "clear"` for `carry.oldSessionId`: `$.clock.after(0, ...)` then hand over (step 7). Any other reason with a carry: `cancelChat`, delete the carry.
6. Compact: when `$.session.compact` resolves without `skip`, hand over. On `skip` or rejection: delete the carry and submit a notice naming the reason.
7. Hand over: if `carry.chatHandle`, `completeChat(oldSessionId)`; `$.session.append({ message: { type: 'user', content: [{ type: 'text', text: ledgerMessage(ledger) }] } })`; if `then`, `$.prompt.submit({ text: then })`; delete the carry.
8. `session.start`: a carry file whose `oldSessionId` is not the current session id resumes at step 7 (a hot reload mid-way).

- [ ] **Step 1: Write the failing harness tests** (`claude-code/testing`, a fake `$.process.run` answering the `rt chat handoff` calls):
  - `the tool is registered, not deferred, and allowed`
  - `clear mode begins the chat hand-off and writes a carry`
  - `a background shell at turn end abandons the reset` (Stop with a running `shell` task → no `command.run`, a `cancel` call, a notice prompt)
  - `after the clear, complete runs and the ledger is appended before then is submitted`
  - `a then starting with / is submitted on its own`
  - `compact mode passes the ledger as compaction instructions and does no hand-off`
  - `an exit with a carry cancels the hand-off`
  - `a carry found at session.start for an old session is handed over`
- [ ] **Step 2: Run them to see them fail**
  Run: `bun run mods:build fresh-context && claude plugin test plugins/fresh-context`
  Expected: FAIL.
- [ ] **Step 3: Implement the four modules.**
- [ ] **Step 4: Run them to see them pass**
  Run: `bun run mods:build fresh-context && claude plugin test plugins/fresh-context && claude plugin validate plugins/fresh-context`
  Expected: PASS, validation clean.
- [ ] **Step 5: Commit**
  `git commit -m "fresh-context: the fresh_context tool, reset and ledger hand-over"`

### Task 7: The `/fresh` command

**Files:**
- Create: `mods/fresh-context/src/command.ts`
- Test: `mods/fresh-context/harness/command.test.ts`

**Interfaces:**
- Consumes: the tool name from Task 6.
- Produces: `/fresh [clear|compact] [note]`, registered at `session.start` with description `"Write your ledger, then start fresh (clear by default)"`. Its `command.run` hook submits one prompt and returns `{ text: "Asked the session to write its ledger and reset (<mode>)." }`.

The prompt, exactly (with `<mode>` and the optional `<note>` filled in):
```
Write your ledger now: the one your current skill keeps, or if none does, these sections: Goal, Where, Done, In progress, Next step, Decisions, Learned, Waiting on Matt. Then call mcp__fresh-context__fresh_context with mode "<mode>", the ledger, and then "<note>".
```
With no note, the last clause is `and no then.`

- [ ] **Step 1: Write the failing tests**: bare `/fresh` submits the prompt with mode `clear` and `and no then.`; `/fresh compact pick up the review` gives mode `compact` and then `pick up the review`; `/fresh nonsense` treats the whole argument as the note with mode `clear`.
- [ ] **Step 2: Run them to see them fail** (same command as Task 6 Step 2). Expected: FAIL.
- [ ] **Step 3: Implement `command.ts`** and register it from `register.ts`.
- [ ] **Step 4: Run them to see them pass** (same command as Task 6 Step 4). Expected: PASS.
- [ ] **Step 5: Commit**
  `git commit -m "fresh-context: add the /fresh command"`

### Task 8: Ship it on by default

**Files:**
- Create: `plugins/fresh-context/` (built by `bun run mods:build fresh-context`, committed like `plugins/human-todos`)
- Modify: `marketplace/marketplace.json` (entry after `human-todos`, same description as `mod.json`)
- Modify: `lib/setup/base-plugins.ts` (`"fresh-context@mattstack"` after `"human-todos@mattstack"`)
- Modify: `lib/setup/__tests__/steps-c.test.ts`, `lib/setup/__tests__/fixtures/plugin-list.json` where they enumerate the base plugins
- Modify: `.github/workflows/checks.yml` (a `plugin-fresh-context` job copied from `plugin-human-todos`), `scripts/ci/test-scope.ts` if it lists plugin trees by name

- [ ] **Step 1: Run the guards to see them fail** after adding the plugin tree
  Run: `bun test scripts/__tests__/no-plugin-ci-jobs.test.ts lib/setup/__tests__/steps-c.test.ts`
  Expected: FAIL (missing CI job, base plugin list mismatch).
- [ ] **Step 2: Add the marketplace entry, base plugin, fixtures and CI job.**
- [ ] **Step 3: Run the guards to see them pass** (same command). Expected: PASS.
- [ ] **Step 4: Commit**
  `git commit -m "fresh-context: ship the mod and install it by default"`

### Task 9: Live check in a herdr probe

No code unless a check fails. Run under the dev app, in a scratch herdr pane with the built plugin (`claude --plugin-dir plugins/fresh-context`), signed in to chat in a scratch room.

- [ ] **Step 1:** Call `fresh_context` with `mode: "clear"` and a short ledger. Expected: new session id; `rt chat buddies --json` shows the same handle never `offline` (poll every 100 ms across the reset); the welcome frame arrives; the ledger is in context.
- [ ] **Step 2:** From another session, DM the probe during the reset. Expected: the DM is in the welcome catch-up.
- [ ] **Step 3:** Start a `run_in_background` shell, then call the tool. Expected: refused, naming the shell. Record in the README whether `/clear` kills background work.
- [ ] **Step 4:** `mode: "compact"`. Expected: same session id, summary keeps the ledger, `then` runs.
- [ ] **Step 5:** `ScheduleWakeup` 120 s, then `fresh_context` clear with no `then`. Expected: the session sits idle with the ledger and the wakeup fires once.
- [ ] **Step 6:** Commit any README updates.
  `git commit -m "fresh-context: record live-check findings"`
