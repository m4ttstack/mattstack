# Merge Asks the Session to Leave (RT-576) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a PR merges, a live Claude session inside its worktree is asked in its pane to close or leave, instead of being killed.

**Architecture:** The merge path in `disposeTree` stops signalling sessions: it marks the tree `leaving`, records which sessions were inside, and disposes once none is (or kills after a 3-minute grace). A hidden `rt worktree await-leave` verb lets the mattstack plugin's mod watch its own tree; the mod asks through a new `$.gateForm.ask` noun that gate-form provides regardless of `rt.gates.kitForm`, then leaves via ExitWorktree or `/cd`.

**Tech Stack:** Bun/TypeScript (rt CLI and daemon), Claude Code mods API, gate-form (mod-kit).

**Spec:** `docs/superpowers/specs/2026-11-14-merge-asks-session-to-leave-design.md`

## Global Constraints

- Question timeout: 2 minutes (`120_000` ms); on timeout the session exits the worktree and continues.
- Daemon grace before the fallback kill: 3 minutes (`180_000` ms) from when the tree was marked leaving.
- Choice labels, verbatim: `Close session`, `Exit worktree and continue`.
- A tree already provisioned to another owner (`reclaimed`): exit at once, no question.
- The question opens whether `rt.gates.kitForm` is on or off.
- No setting gates the feature; it replaces the merge-path kill.
- Only the merge path changes. Parking, cleanup, triage and herd job trees keep today's behaviour.
- Leaving = `ExitWorktree { action: "keep" }`, then `/cd <mainCheckout>` if the session's cwd is still inside the tree. Verified live: ExitWorktree and EnterWorktree both move the `claude` process's real cwd (what `lsof -d cwd` reads).
- rt CLI prints only through `lib/ui/out.ts`; the verb's stdout is a payload (`out.payload`, one JSON line).
- Repo rules: targeted tests only locally; mods via `bun run mods:test`, plugin harness via `claude plugin test plugins/<name>`; `bun run mods:build --no-validate` must leave `git status --porcelain -- plugins/` empty.
- Plugin versions: bump in `mods/<name>/mod.json` (source) and rebuild; mattstack in `plugins/mattstack/.claude-plugin/plugin.json`, one past main at merge time.

## Review Focus

1. A session that is mid-turn when the mark lands: its `/cd` or ExitWorktree queues until idle; the daemon must not dispose while its cwd is still inside (Task 3 test: an agent still inside on the second pass keeps the tree).
2. A daemon restart between marking and disposing: the mark and departures are in the store, so the next pass resumes the countdown from `leaving.since`, not from restart time (Task 4 test).
3. Two sessions in the same tree, one leaves and one doesn't answer: the tree waits for both, then the grace kill stops only the one still inside (Task 3 test).
4. gate-form reloaded while a plugin ask is open: the caller's promise is gone, so the orphaned form must close rather than sit open with no one to resolve it (Task 6 test).
5. A session resumed into a recycled path long after (not alive at disposal): `--started` against the transcript reports `reclaimed` (Task 5 test).

---

### Task 1: Kill planner — find agents inside, kill a departed session's leftovers

**Files:**
- Modify: `lib/daemon/worktree-process-kill.ts`
- Test: `lib/daemon/__tests__/worktree-process-kill.test.ts`

**Interfaces:**
- Produces:
  - `export async function agentSessionsInside(path: string, opts: Pick<KillWorktreeOptions, "excludePaths" | "identify" | "run" | "selfPids">): Promise<StoppedSession[]>`: agents (by `DEFAULT_AI_AGENT_NAMES`) whose own cwd is inside `path`, with identity resolved; no signals.
  - `KillPlanInput.killDepartedChildren?: boolean` and `KillWorktreeOptions.killDepartedChildren?: boolean`: when true, a non-agent process whose cwd is inside the target is a target even if it belongs to the family of an agent outside the target. Agents themselves are never targeted by this flag.

- [ ] **Step 1: Write failing tests** in the planner suite:
  - `planWorktreeKill with killDepartedChildren targets a dev server whose parent agent sits outside the tree`: table has agent pid 10 (cwd `/other`), child `node` pid 11 (cwd `/t/app`), target `/t`; expect targets `[11]`, stoppedSessions `[]`.
  - `without killDepartedChildren the same child is spared` (today's rule): targets `[]`.
  - `killDepartedChildren never targets an agent`: agent pid 12 with cwd `/t`, `stopSessionsInside: false`; expect 12 not in targets.
  - `agentSessionsInside lists only agents whose own cwd is inside`: fake `run` returning ps/lsof output with one claude in `/t` and one in `/other`; expect one result with pid and cwd.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/worktree-process-kill.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** both in `worktree-process-kill.ts`: in `planWorktreeKill`, the spared set from agent families skips attributed non-agent pids when `killDepartedChildren`; `agentSessionsInside` reuses the existing ps/lsof read and `attributeCwds`.
- [ ] **Step 4: Run** the same test file. Expected: PASS.
- [ ] **Step 5: Commit** `worktree-kill: find agents inside a tree; kill a departed session's leftovers on request`.

### Task 2: Leaving mark and departures record

**Files:**
- Modify: `lib/worktree/registry.ts` (TreeRecord)
- Create: `lib/worktree/departures.ts`
- Test: `lib/worktree/__tests__/departures.test.ts`

**Interfaces:**
- Produces:
  - `TreeRecord.leaving?: { why: string; since: string }` (since = ISO).
  - `export function recordDepartures(path: string, sessionIds: string[], at: string): void` (kv namespace `worktree-departures`, keyed by realpath'd `path`, value `Record<sessionId, at>`; entries older than 14 days dropped on write).
  - `export function departedAt(path: string, sessionId: string): string | null`.

- [ ] **Step 1: Write failing tests**: `recordDepartures then departedAt returns the time`; `departedAt is null for another session or path`; `a departure older than 14 days is dropped on the next write`; `recording twice keeps the earliest time for a session`.
- [ ] **Step 2: Run** `bun test lib/worktree/__tests__/departures.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `departures.ts` over `getKvValue`/`setKvValue` (`lib/state/index.ts`); add the field to `TreeRecord`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `worktree: a leaving mark on the tree record and a departures record`.

### Task 3: disposeTree asks instead of stopping

**Files:**
- Modify: `lib/worktree/dispose.ts`
- Test: the existing dispose suite (`lib/worktree/__tests__/dispose*.test.ts`; add cases there)

**Interfaces:**
- Consumes: Task 1 `agentSessionsInside`, `killDepartedChildren`; Task 2 `leaving`, `recordDepartures`.
- Produces: `disposeTree` opt `askSessions?: { why: string }` (replaces `stopSessions` for the merge path; `stopSessions` stays for the fallback). Exported `LEAVE_GRACE_MS = 180_000`. New refusal code `"leaving"`. Event `worktree:leaving` emitted with `{ repo, tree, path, why }` when the mark is set.

Flow, after every existing guard (where the kill sits today), only when `askSessions` is set and `deps.killProcesses`:
1. `inside = agentSessionsInside(rec.path, …)`.
2. No mark and `inside` empty: dispose as today with `killDepartedChildren: true`, no `stopSessions`.
3. No mark and `inside` non-empty: set `leaving = { why, since: now }` on the registry record, `recordDepartures(rec.path, inside' session ids, now)`, emit, return `{ disposed: false, refusal: "leaving" }`. No signal sent.
4. Marked, `inside` empty: dispose with `killDepartedChildren: true`.
5. Marked, `inside` non-empty, `now - since < LEAVE_GRACE_MS`: record any newly seen sessions' departures, return `refusal: "leaving"`.
6. Marked, grace elapsed: dispose with `stopSessions: { why }` and `killDepartedChildren: true` (today's kill and chat notice).

- [ ] **Step 1: Write failing tests** (fake `killWorktree`/`agentSessionsInside` seams on `DisposeDeps`; add `agentsInside?` seam):
  - `first merge pass with a session inside marks leaving, records the departure and kills nothing`.
  - `next pass with nobody inside disposes and kills leftovers` (asserts `killDepartedChildren: true`, no `stopSessionsInside`).
  - `a pass inside the grace with the session still inside keeps the tree`.
  - `a pass after 180000 ms with a session still inside disposes with stopSessions`.
  - `two sessions inside: one leaves, the other is still inside at grace; only the remaining one is stopped` (assert the kill opts and that the departed one is in departures).
  - `no session inside on the first pass disposes at once`.
  - `a guard refusal (dirty) still wins before any mark is set`.
- [ ] **Step 2: Run** the dispose suite. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the flow in `disposeTree`; write the mark with the registry's patch helper used elsewhere in the file.
- [ ] **Step 4: Run** the dispose suite. Expected: PASS.
- [ ] **Step 5: Commit** `dispose: a merged tree waits for its sessions to leave, then kills after 3 minutes`.

### Task 4: Reactor drives leaving trees every pass

**Files:**
- Modify: `lib/daemon/reconciler/reactor.ts`
- Test: `lib/daemon/reconciler/__tests__/reactor.test.ts`

**Interfaces:**
- Consumes: Task 3 `askSessions`, refusal `"leaving"`.
- Produces: `export async function drainLeavingTrees(deps: ReactorDeps): Promise<void>`, called from `detectTransitions` on every pass, re-running `disposeTree(…, { auto: true, askSessions: { why: rec.leaving.why } })` for each tree with `leaving` set.

- [ ] **Step 1: Write failing tests**:
  - `a merge with a session inside leaves the tree claimed and marked, without a kill` (reactor calls with `askSessions`, not `stopSessions`).
  - `a later pass with the merge edge already spent still disposes once the session has left`.
  - `after a daemon restart the grace counts from leaving.since`: seed a record with `since` 200 s ago and a session inside; expect dispose with `stopSessions`.
  - `a "leaving" refusal does not flip the tree to disposable` (unlike other refusals).
- [ ] **Step 2: Run** `bun test lib/daemon/reconciler/__tests__/reactor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: swap `stopSessions` for `askSessions` at the merge call (`reactor.ts` ~line 412); treat `"leaving"` as a hold (no `markDisposable`, fired key unspent is fine since `drainLeavingTrees` owns follow-up); add `drainLeavingTrees` under the same tree lock the reactor uses.
- [ ] **Step 4: Run** the reactor suite and `bun test lib/daemon/__tests__/worktree-reconciler*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `reactor: ask sessions to leave a merged tree and finish the disposal on later passes`.

### Task 5: `rt worktree await-leave`

**Files:**
- Create: `commands/worktree-await-leave.ts`
- Modify: `lib/command-tree-def.ts` (hidden `await-leave` under `worktree`, beside `is-registered`)
- Test: `commands/__tests__/worktree-await-leave.test.ts`

**Interfaces:**
- Consumes: Task 2 `leaving`, `departedAt`; `treeByPath` from the registry (as `worktreePathState` in `commands/worktree-hook.ts` does).
- Produces:
  - Usage: `rt worktree await-leave <path> --session <id> [--started <iso>] [--timeout <seconds>]` (default timeout 60).
  - Stdout: one JSON line, exactly one of `{"state":"leaving","why":string,"mainCheckout":string}`, `{"state":"reclaimed","mainCheckout":string}`, `{"state":"none"}`, `{"state":"timeout"}`. Exit 0 for all four.
  - Pure core: `export function leaveState(input: { tree: TreeRecord | null; mainCheckout: string | null; departed: string | null; lastActive: string | null }): LeaveAnswer | null` (null = keep waiting).
  - `lastActive`: newest transcript entry `timestamp` strictly before `--started`, read from the session's transcript (locate it the way `lib/usage/transcripts.ts` indexes `~/.claude/projects`); null when not given or not found.

Rules (in order): no tree at the path, or not an rt ephemeral tree → `none`. `departed` set and `tree.claimedAt > departed` → `reclaimed`. `lastActive` set and `tree.claimedAt > lastActive` → `reclaimed`. `tree.leaving` set → `leaving`. Else null. The command polls `treeByPath` every 2 s (local store read; no daemon call) until an answer or the timeout.

- [ ] **Step 1: Write failing tests** for `leaveState`: each rule, plus `a departed session whose tree was not re-claimed since is leaving, not reclaimed`; and one command test with a seeded registry asserting the exact stdout line for `leaving` and that `--timeout 1` prints `{"state":"timeout"}`.
- [ ] **Step 2: Run** `bun test commands/__tests__/worktree-await-leave.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the command and tree entry (`hidden: true`, `omitBehavior: { exempt: "agent-facing; run by the mattstack plugin's worktree mod, never interactively" }`, description in plain words per `.claude/rules/command-tree.md`).
- [ ] **Step 4: Run** the test and `bun test lib/__tests__/command-tree*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `worktree: await-leave tells a session its tree is leaving or reused`.

### Task 6: gate-form `$.gateForm.ask`

**Files:**
- Modify: `mods/gate-form/src/register.tsx`, `mods/gate-form/src/form/state.ts` (or wherever `Form`/`settle` live), `mods/gate-form/types/index.d.ts`, `mods/gate-form/mod.json` (0.5.1 → 0.6.0)
- Test: a new `mods/gate-form/src/form/plugin-ask.test.ts`
- Rebuild: `plugins/gate-form/`

**Interfaces:**
- Produces (contract in `types/index.d.ts`, declared on `EngineInterface` as `gateForm: GateForm`):
  - `export type GateFormAskArgs = { title: string; context?: string; label: string; options: { value: string; label: string; description?: string }[]; timeoutMs: number }`
  - `export type GateFormAskResult = { value: string } | { timedOut: true } | { closed: true }`
  - `export type GateForm = { ask: (args: GateFormAskArgs) => Promise<GateFormAskResult> }`
- `Form.source` gains `'plugin'`; such a form has one single-pick question, no Other row, no More actions.

- [ ] **Step 1: Write failing tests**:
  - `ask opens a plugin form with the setting off and resolves with the picked value`.
  - `ask resolves timedOut after timeoutMs and closes the form`.
  - `a plugin form left from before a reload is closed on session start` (Review Focus 4).
  - `a plugin form's answer is never sent to the agent as a prompt`.
- [ ] **Step 2: Run** `bun run mods:test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement**: an `engine.create` hook adds the noun unconditionally (not behind `setting.isOn`); a module-level `Map<formId, resolve>`; `settle` resolves and closes a `'plugin'` form instead of submitting a prompt; a timer resolves `timedOut`; `session.start` closes `'plugin'` forms with no resolver.
- [ ] **Step 4: Run** `bun run mods:test`, `bun run mods:build --no-validate`, `claude plugin test plugins/gate-form`. Expected: PASS, and `git status --porcelain -- plugins/` shows only the rebuilt gate-form files, which are committed.
- [ ] **Step 5: Commit** `gate-form: an ask other plugins can call, open with the kit-form setting off`.

### Task 7: mattstack worktree-leave mod

**Files:**
- Create: `plugins/mattstack/hooks/worktree-leave.ts`
- Modify: `plugins/mattstack/hooks/register.ts` (join it), `plugins/mattstack/.claude-plugin/plugin.json` (version one past main), `plugins/mattstack/hooks/README.md` (one paragraph)
- Test: `plugins/mattstack/hooks/tests/worktree-leave.test.ts` (follow the existing tests folder's harness)

**Interfaces:**
- Consumes: Task 5 verb and its JSON; Task 6 `$.gateForm.ask`.
- Produces: `export const register: Register` in `worktree-leave.ts`.

Behaviour:
- `session.start`: note `started = new Date().toISOString()`; start one watch loop per module (not awaited). Each iteration: `cwd = await $.session.cwd()`; run `rt worktree await-leave <cwd> --session <id> --started <started> --timeout 60` (try `rt`, then `$HOME/.local/bin/rt`, as `enter-worktree-check.ts` does); act on the answer; on `timeout` loop; on `none` sleep 60 s via `$.clock` and loop (cwd may change); stop on module unload.
- `leaving`: `$.gateForm.ask({ title: why, label: "Your worktree is being cleaned up.", options: [{ value: "close", label: "Close session" }, { value: "leave", label: "Exit worktree and continue" }], timeoutMs: 120_000 })`. `close` → `$.command.run({ command: "exit" })`. `leave`, `timedOut`, `closed`, or no `$.gateForm` (gate-form missing or older) → leave.
- `reclaimed` → leave with no question.
- Leave: `$.tool.call({ tool: "ExitWorktree", action: "keep" })` (ignore a rejection); then if `await $.session.cwd()` is still inside the tree, `$.command.run({ command: "cd", args: mainCheckout })`. Then `$.ui.log("<why>: left the worktree; now in <mainCheckout>")` for the person and `$.session.append` a user-role text row telling the model the same, so its next tool calls use the new directory.

- [ ] **Step 1: Write failing tests** with a faked `$` (`process.run`, `session.cwd`, `gateForm.ask`, `tool.call`, `command.run`, `ui.log`, `session.append`):
  - `leaving and a Close pick runs /exit`.
  - `leaving and an Exit pick calls ExitWorktree keep and appends the note`.
  - `a timed-out question leaves`.
  - `reclaimed leaves without asking`.
  - `ExitWorktree that leaves the cwd inside falls back to /cd mainCheckout`.
  - `no gateForm noun leaves without asking`.
- [ ] **Step 2: Run** the mattstack hooks tests (the command the tests folder's README or `package.json` names; else `bun test plugins/mattstack/hooks/tests/worktree-leave.test.ts`). Expected: FAIL.
- [ ] **Step 3: Implement** `worktree-leave.ts` and join it in `register.ts`.
- [ ] **Step 4: Run** the tests and `claude plugin validate plugins/mattstack`. Expected: PASS, no refused hooks.
- [ ] **Step 5: Commit** `mattstack: a session asked to leave a merged worktree closes or moves out`.

### Task 8: Live check

No code. With the branch's daemon and plugins live (main checkout on this branch, daemon restarted, plugins reloaded in a test pane), merge-dispose a throwaway tree that holds a test session:
- the question appears in the test pane; Exit moves the session to the main checkout and the tree is disposed on the next pass;
- an unanswered question leaves after 2 minutes;
- `/cd` (the resume case) moves the process cwd (check with `lsof -a -d cwd -p <pid>`);
- a resumed session in a re-claimed path leaves at once.
Record results in the ledger; fix anything that fails in its owning task.
