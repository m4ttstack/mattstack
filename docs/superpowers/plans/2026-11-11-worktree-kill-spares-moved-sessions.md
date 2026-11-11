# Worktree kill spares moved sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disposing a worktree never kills an agent session that moved to another tree; the merge reactor stops an agent still inside the tree and names it in the daemon log and its chat rooms.

**Architecture:** A pure planner over the full process table and full lsof cwd map decides targets in `lib/daemon/worktree-process-kill.ts`; `killWorktreeProcesses` gathers inputs through injectable seams, resolves identities before signalling, and returns stopped sessions. `disposeTree` gains `opts.stopSessions` (only the reactor passes it) and `deps.notify`, which `lib/daemon.ts` wires to `chat:post` as the system handle.

**Tech Stack:** Bun, TypeScript, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-11-worktree-kill-spares-moved-sessions-design.md`

## Global Constraints

- Every test uses fake `ps`/`lsof` output, a fake signal function, and stub resolvers; no test signals a real process or reads the real `~/.mattstack`. The one existing test that runs the real kill against a temp dir (`dispose.test.ts`, "killProcesses wiring runs the killer...") stays as is.
- Run only the touched test files, from the worktree root: `bun test <file>`. Never the full suite.
- Never run rt, the daemon or a built binary; never dispose or provision a real worktree.
- Write only under `lib/worktree/`, `lib/daemon/worktree-process-kill.ts`, a new `lib/daemon/session-identity.ts`, `lib/daemon/reconciler/reactor.ts`, `lib/daemon/worktree-reconciler.ts`, their `__tests__`, and the wiring-only edit in `lib/daemon.ts` (stay clear of the run-outcome refresher area).
- No em or en dashes anywhere. Comments only state a constraint the code cannot show.
- Exports `agentSessionPids`, `selectKillTargets`, `isUserOrAgentProcess`, `attributeCwds`, `safeRealpath`, `nestedExcludes` keep their signatures and behaviour (used by `lib/notifier.ts` and `tree-holders.ts`).
- Agent names: the existing `DEFAULT_AI_AGENT_NAMES`. Escalation: SIGKILL after `ESCALATE_AFTER_MS` (5000).
- Stage named files only; commit after each task.

## Review Focus

1. The daemon's `process.ppid` is 1 (launchd): a protected pid of 1 must not spare the whole machine. Test in Task 1.
2. A pid that appears in `ps` but not in lsof (permission denied, raced exit): an agent with unknown cwd counts as outside and is spared. Test in Task 1.
3. A ppid cycle or a ppid pointing at a pid missing from the table must not loop or throw. Test in Task 1.
4. `ps -A` succeeding but lsof failing (or the reverse) signals nothing. Test in Task 3.
5. A stopped agent with no Claude registry entry or no chat presence is still logged (by pid and label) and the dispose still completes. Tests in Tasks 2 and 4.

---

### Task 1: Pure kill planner

**Files:**
- Modify: `lib/daemon/worktree-process-kill.ts`
- Test: `lib/daemon/__tests__/worktree-process-kill.test.ts`

**Interfaces:**
- Produces:
  - `interface ProcRow { pid: number; ppid: number; command: string; fullCommand: string }` (same shape as `KillCandidate`; alias it)
  - `interface StoppedSessionPlan { pid: number; label: string; cwd: string }`
  - `interface KillPlanInput { target: string; excludes: string[]; table: ProcRow[]; cwds: Map<number, string>; protectedPids: number[]; stopSessionsInside: boolean }`
  - `function planWorktreeKill(input: KillPlanInput): { targets: KillCandidate[]; stoppedSessions: StoppedSessionPlan[] }`
  - `function processLabel(proc: ProcRow): string` (argv0 basename with a leading `-` stripped; falls back to `command`)

- [ ] **Step 1: Write the failing tests** in a new `describe("planWorktreeKill", ...)`, with `A = "/w/haldir"`, `B = "/w/shelob"`, `excludes: []`, `protectedPids: []` unless stated. Helper `plan(table, cwds, opts)` builds the input.
  - `"incident replay: a moved session's shell and children in A are spared, workload is not"`: rows `1 launchd`, `500 0 herdr "/Users/x/.local/bin/herdr server"` (ppid 1), `600 500 -zsh "-zsh"`, `601 600 claude "/Users/x/.local/bin/claude --model opus"`, `602 601 .bun "/Users/x/.bun/bin/bun run mcp"`, `603 601 .loc "/Users/x/.local/bin/herdr mcp"`, `700 1 node "node vite"`; cwds `600->A, 601->B, 602->A, 603->A/sub, 700->A`. Expect target pids `[700]` and `stoppedSessions` `[]`, for both `stopSessionsInside: true` and `false`.
  - `"a login shell with no agent is spared"`: rows `600 1 -zsh "-zsh"`, cwd A. Targets `[]`.
  - `"protected pid 1 does not spare unrelated workload"`: rows `700 1 node "node vite"`, cwd A, `protectedPids: [1, 999]`. Targets `[700]`.
  - `"an agent inside A is stopped only with stopSessionsInside"`: rows `600 1 -zsh "-zsh"`, `601 600 claude "claude"`, `602 601 bun "bun run mcp"`; cwds all A. With true: targets `[601]`, `stoppedSessions` `[{ pid: 601, label: "claude", cwd: A }]`. With false: targets `[]`, `stoppedSessions` `[]`.
  - `"an agent above a protected caller pid is spared with its family"`: rows `601 1 claude "claude"`, `650 601 zsh "zsh -c rt"`, `651 650 rt "rt worktree dispose"`; cwds all A; `protectedPids: [651]`, `stopSessionsInside: true`. Targets `[]`, `stoppedSessions` `[]`.
  - `"spare wins: an agent in A under a moved session is not stopped"`: rows `601 1 claude "claude"` (cwd B), `610 601 codex "codex"` (cwd A), `611 610 node "node x"` (cwd A); true. Targets `[]`, `stoppedSessions` `[]`.
  - `"an agent with unknown cwd counts as outside"`: rows `601 1 claude "claude"` (no cwd entry), `602 601 node "node vite"` (cwd A); true. Targets `[]`.
  - `"a ppid cycle or a missing parent does not loop"`: rows `800 801 node "node a"`, `801 800 node "node b"`, `802 4242 node "node c"`; cwds all A. Targets `[800, 801, 802]` (sorted).
  - `"nested excluded tree owns its processes"`: rows `700 1 node "node vite"` (cwd `A/nested`), `excludes: ["/w/haldir/nested"]`. Targets `[]`.
  - `"labels use argv0, not the truncated comm"`: `processLabel({ pid: 1, ppid: 0, command: ".loc", fullCommand: "/Users/x/.local/bin/claude --x" })` is `"claude"`; for `"-zsh"` it is `"zsh"`.

- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/worktree-process-kill.test.ts`. Expected: the new tests FAIL (`planWorktreeKill` not exported); existing tests pass.

- [ ] **Step 3: Implement** `planWorktreeKill` and `processLabel` per spec section 1. Make the private `processNames` strip a leading `-` from each name (this also fixes `isUserOrAgentProcess` and `agentSessionPids` for login shells; their existing tests must still pass). Build parent and child maps from `table`; ancestor walks stop at pid 0/1 and at a pid already visited; descendant walks use a visited set. Drop 0 and 1 from `protectedPids` before use. Workload attribution reuses `attributeCwds(target, excludes, cwds)`; a root is inside A when `attributeCwds` would attribute its cwd. Return targets sorted by pid.

- [ ] **Step 4: Run** the same command. Expected: all PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/daemon/worktree-process-kill.ts lib/daemon/__tests__/worktree-process-kill.test.ts
git commit -m "worktree-kill: plan over the full process table, spare moved sessions (RT-555)"
```

### Task 2: Session identity resolver

**Files:**
- Create: `lib/daemon/session-identity.ts`
- Test: `lib/daemon/__tests__/session-identity.test.ts`

**Interfaces:**
- Produces:
  - `interface SessionIdentity { sessionId: string; handle?: string; pane?: string; rooms: string[] }`
  - `interface IdentifyDeps { sessionForPid: (pid: number) => string | null; presenceForSession: (sessionId: string) => { handle: string; pane?: string | null } | null; listRooms: (handle: string) => { room: string }[] }`
  - `function identifySession(pid: number, deps?: IdentifyDeps): SessionIdentity | null` (default deps: `sessionForPid` from `lib/claude-registry.ts`, `presenceForSession` from `lib/state/presence-store.ts`, `listRooms` from `lib/state/chat-store.ts`)
  - `function sessionDisplayName(pid: number, label: string, identity: SessionIdentity | null): string` returning `identity.handle` when present, else `pid <pid> (<label>)`

- [ ] **Step 1: Write the failing tests** (stub deps only):
  - `"full identity"`: sessionForPid 601 -> `"s-1"`, presence -> `{ handle: "rt-555", pane: "p7" }`, listRooms -> `[{ room: "mattstack" }, { room: "herd-x" }]`. Expect `{ sessionId: "s-1", handle: "rt-555", pane: "p7", rooms: ["mattstack", "herd-x"] }`.
  - `"no registry entry returns null"`: sessionForPid -> null. Expect null.
  - `"no presence keeps the session id with no rooms"`: expect `{ sessionId: "s-1", rooms: [] }`.
  - `"a throwing dep returns what it had"`: listRooms throws. Expect `{ sessionId: "s-1", handle: "rt-555", pane: "p7", rooms: [] }`, no throw.
  - `"display name falls back to pid and label"`: `sessionDisplayName(601, "claude", null)` is `"pid 601 (claude)"`; with a handle it is the handle.

- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/session-identity.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** Each step in try/catch; a caught error logs at warn through `lazyChildLogger("worktree-kill")` with `{ err, pid }` and stops at what it has.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/daemon/session-identity.ts lib/daemon/__tests__/session-identity.test.ts
git commit -m "worktree-kill: resolve a stopped session's chat identity (RT-555)"
```

### Task 3: `killWorktreeProcesses` on the planner

**Files:**
- Modify: `lib/daemon/worktree-process-kill.ts` (the `killWorktreeProcesses` body, options, result, header comment)
- Test: `lib/daemon/__tests__/worktree-process-kill.test.ts`

**Interfaces:**
- Consumes: `planWorktreeKill`, `processLabel` (Task 1); `identifySession`, `SessionIdentity` (Task 2).
- Produces:
  - `function parseLsofAllCwds(lsofOutput: string): Map<number, string>` (every `p`/`n` pair, unfiltered)
  - `KillWorktreeOptions` gains `stopSessionsInside?: boolean`, `identify?: (pid: number) => SessionIdentity | null`, `run?: (argv: string[], opts: { timeoutMs: number }) => Promise<{ exitCode: number; stdout: string }>`, `signal?: (pid: number, sig: NodeJS.Signals | 0) => void`, `selfPids?: number[]` (defaults `[process.pid, process.ppid]`)
  - `interface StoppedSession extends StoppedSessionPlan { identity: SessionIdentity | null }`
  - `WorktreeKillResult` becomes `{ terminated: { pid: number; label: string }[]; stoppedSessions: StoppedSession[] }`

- [ ] **Step 1: Write the failing tests** in `describe("killWorktreeProcesses", ...)`, using a temp dir from `mkdtempSync` as the tree path (so `safeRealpath` resolves) and a fake `run` that answers by argv: lsof (`-d cwd -Fpn`) with `p<pid>\nn<cwd>` lines, `ps -A -o pid=,ppid=,comm=,args=` with rows, `ps eww ...` with empty output. `signal` records `[pid, sig]` into an array; `selfPids: [99999]`.
  - `"incident replay signals only the workload"`: the Task 1 incident rows with A = the temp dir and B another temp dir. Expect recorded signals `[[700, "SIGTERM"]]`, `stoppedSessions` `[]`.
  - `"lsof failing signals nothing"`: lsof answers `{ exitCode: 1, stdout: "" }`. Expect no signals, `{ terminated: [], stoppedSessions: [] }`.
  - `"ps -A failing signals nothing"`: same for ps.
  - `"identity is resolved before any signal"`: agent 601 with cwd in A, `stopSessionsInside: true`; `identify` pushes `"identify:601"` into a shared log and `signal` pushes `"signal:601"`. Expect the log to start `["identify:601", "signal:601"]` and `stoppedSessions[0]` to equal `{ pid: 601, label: "claude", cwd: <A realpath>, identity: <the stub's value> }`.
  - `"without stopSessionsInside an agent in A is never identified or signalled"`.

- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/worktree-process-kill.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement.** Gather with one lsof and one `ps -A`; either failing (non-zero with empty stdout, as today) warns and returns the empty result. Parse `ps` rows with today's regex; realpath every cwd. Call `planWorktreeKill` with `protectedPids: [...selfPids, ...callerPids]`. Identify each stopped session before signalling. Keep the `ps eww` package-script labels, the unlabeled warn, the info line and the SIGKILL escalation, all through `signal`. Labels come from `processLabel` when no script label exists. Rewrite the header comment to the new contract (moved sessions spared with their family; agents inside the tree stopped only on request).

- [ ] **Step 4: Run** the same command. Expected: PASS (all old and new tests).

- [ ] **Step 5: Commit**
```bash
git add lib/daemon/worktree-process-kill.ts lib/daemon/__tests__/worktree-process-kill.test.ts
git commit -m "worktree-kill: gather the full table, identify before signalling (RT-555)"
```

### Task 4: `disposeTree` stops, logs and notifies

**Files:**
- Modify: `lib/worktree/dispose.ts`
- Test: `lib/worktree/__tests__/dispose.test.ts`

**Interfaces:**
- Consumes: `killWorktreeProcesses`, `KillWorktreeOptions`, `WorktreeKillResult`, `StoppedSession` (Task 3); `sessionDisplayName` (Task 2).
- Produces:
  - `DisposeDeps.notify?: (post: { room: string; body: string }) => Promise<void>`
  - `DisposeDeps.killWorktree?: (path: string, opts: KillWorktreeOptions) => Promise<WorktreeKillResult>` (default `killWorktreeProcesses`)
  - `disposeTree` opts gain `stopSessions?: { why: string }`
  - `function stoppedSessionNotice(args: { name: string; tree: string; why: string; trashPath: string | null }): string` (exported for the test)

- [ ] **Step 1: Write the failing tests** with `makeDeps({ killProcesses: true, killWorktree: fake, notify: fake })`, where the fake kill records its opts and returns one stopped session `{ pid: 601, label: "claude", cwd: path, identity: { sessionId: "s-1", handle: "rt-555", pane: "p7", rooms: ["mattstack", "herd-x"] } }`; `log.warn` records calls.
  - `"stopSessions turns on the session stop, logs it and posts to each room after retire"`: `disposeTree(deps, rec, { auto: true, stopSessions: { why: "PR #1087 merged" } })`. Expect the kill's opts to include `stopSessionsInside: true`; one warn whose fields include `{ pid: 601, sessionId: "s-1", handle: "rt-555", pane: "p7", tree: "tree-a" }`; two notify posts, rooms `["mattstack", "herd-x"]`, each body containing `"rt-555"`, `"tree-a"`, `"PR #1087 merged"` and the outcome's `trash.path` when the outcome has one; the tree path no longer exists when notify is first called.
  - `"manual dispose keeps sessions spared and never notifies"` (the pin): `disposeTree(deps, rec, {})`. Expect the kill's opts `stopSessionsInside` to be false or absent, zero notify calls.
  - `"a session with no identity is logged by pid and posted nowhere"`: identity null. Expect one warn with message containing `"pid 601 (claude)"`, zero notify calls, `disposed: true`.
  - `"a throwing notify does not fail the dispose"`: notify rejects. Expect `disposed: true` and a warn with `err`.
  - `"stoppedSessionNotice names session, tree, reason and trash"`: exact string for `{ name: "rt-555", tree: "haldir", why: "PR #1087 merged", trashPath: "/t/haldir-1" }` is `rt stopped rt-555: it was still working inside worktree haldir, which was disposed after PR #1087 merged. The tree is in the trash at /t/haldir-1.`; with `trashPath: null` the last sentence is omitted.

- [ ] **Step 2: Run** `bun test lib/worktree/__tests__/dispose.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement.** Call `(deps.killWorktree ?? killWorktreeProcesses)(rec.path, { callerPids: deps.callerPids, stopSessionsInside: opts.stopSessions !== undefined })`. Log each stopped session at warn (`stopped agent session <name> working inside <tree>`) right after the kill. After a successful retire, for each stopped session with rooms, `await deps.notify(...)` per room inside try/catch (warn with `{ err, room }`). Keep the existing "worktree processes terminated" info line.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/worktree/dispose.ts lib/worktree/__tests__/dispose.test.ts
git commit -m "dispose: stop and announce agents left in a merged tree (RT-555)"
```

### Task 5: Reactor passes `stopSessions`; reconciler threads `notify`

**Files:**
- Modify: `lib/daemon/reconciler/reactor.ts` (`ReactorDeps`, `actOnTree`'s `disposeTree` call near line 387)
- Modify: `lib/daemon/worktree-reconciler.ts` (`ReconcilerDeps`, the `detectTransitions` call near line 254)
- Test: `lib/daemon/reconciler/__tests__/reactor.test.ts`

**Interfaces:**
- Consumes: `DisposeDeps.notify`, `DisposeDeps.killWorktree`, `stopSessions` (Task 4); `changeNoun`, `changeMarker` from `lib/repo-label.ts`.
- Produces: `ReactorDeps.notify?` and `ReactorDeps.killWorktree?` (same types as on `DisposeDeps`); `ReconcilerDeps.notify?` (same type).

- [ ] **Step 1: Write the failing tests** using the file's existing `detect(...)` helper with a merged MR (iid 83) and `liveCwds` empty, passing a `killWorktree` fake that records its opts and returns `{ terminated: [], stoppedSessions: [] }`:
  - `"a merged-MR dispose stops sessions with the change named"`: expect the fake saw `stopSessionsInside: true`. For the test repo identity, the `why` is `` `${changeNoun(id)} ${changeMarker(id)}83 merged` `` (assert through a stopped session whose notify body contains it: have the fake return one stopped session with rooms `["r"]` and a `notify` fake record bodies).
  - `"a closed MR never reaches the session stop"`: closed state; the fake kill is never called with `stopSessionsInside: true`.

- [ ] **Step 2: Run** `bun test lib/daemon/reconciler/__tests__/reactor.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement.** In `actOnTree`'s merged branch, read the iid from `scopedEntries[branch]?.mr?.iid`; `why` is `` `${changeNoun(deps.repoName)} ${changeMarker(deps.repoName)}${iid} merged` ``, or `` `${changeNoun(deps.repoName)} for ${branch} merged` `` when there is no numeric iid. Pass `notify` and `killWorktree` from `ReactorDeps` into the inline `DisposeDeps` only when set. In `worktree-reconciler.ts`, add `notify?` to `ReconcilerDeps` and spread it into the `detectTransitions` deps the same way `jobTreeHold` is.

- [ ] **Step 4: Run** the same command, then `bun test lib/daemon/__tests__/worktree-reconciler.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/daemon/reconciler/reactor.ts lib/daemon/worktree-reconciler.ts lib/daemon/reconciler/__tests__/reactor.test.ts
git commit -m "reactor: merged-MR dispose stops sessions left inside (RT-555)"
```

### Task 6: Wire `notify` in the daemon, then gates

**Files:**
- Modify: `lib/daemon.ts` (the `createWorktreeReconciler({...})` call near line 1195 only)

**Interfaces:**
- Consumes: `ReconcilerDeps.notify` (Task 5); `SYSTEM_HANDLE` from `lib/daemon/handlers/herd.ts`; `routedHandlers` (declared near line 391, built later).

- [ ] **Step 1: Implement.** Add to the call:
  `notify: async ({ room, body }) => { const post = routedHandlers?.["chat:post"]; if (!post) { log.warn({ room }, "worktree notice dropped: chat not ready"); return; } const res = await post({ room, handle: SYSTEM_HANDLE, body }); if (!res.ok) log.warn({ room, error: res.error }, "worktree notice post failed"); }`
  Import `SYSTEM_HANDLE` if `lib/daemon.ts` does not already.

- [ ] **Step 2: Run gates** from the worktree root: `bun run typecheck` (expected: exit 0), `bun run purity` (expected: exit 0), and once more every touched test file:
  `bun test lib/daemon/__tests__/worktree-process-kill.test.ts lib/daemon/__tests__/session-identity.test.ts lib/worktree/__tests__/dispose.test.ts lib/daemon/reconciler/__tests__/reactor.test.ts lib/daemon/__tests__/worktree-reconciler.test.ts` (expected: all pass). Also `bun test lib/__tests__/no-raw-output.test.ts` since new lib files were added.

- [ ] **Step 3: Commit**
```bash
git add lib/daemon.ts
git commit -m "daemon: wire worktree session notices to chat (RT-555)"
```
