# Worktree kill spares sessions that moved away (RT-555)

## Why

Disposing a worktree (PR merged, stale claim, manual `rt worktree dispose`)
kills the processes whose cwd is inside it. On 2026-11-10 that ended a
running agent mid-task: its pane started in tree `haldir`, it entered tree
`shelob`, and merging the `haldir` PR killed it. Its uncommitted review was
lost and nobody was told.

The daemon log (`worktree-kill`, 2026-11-11T05:40:23Z) shows what was hit:
`-zsh, .bun, .loc, .loc, .loc, .bun, .loc`, then `-zsh` escalated to SIGKILL.

## Root cause

`killWorktreeProcesses` (`lib/daemon/worktree-process-kill.ts`) builds its
process rows only from pids whose cwd is inside the tree, then protects agent
processes and their descendants found in those rows. Two holes:

1. An agent that moved to another tree has its cwd there, so it is not in the
   rows and protects nothing. Its pane shell and the MCP servers and tools it
   started before moving still have their cwd in the old tree, so they become
   kill targets. Killing the pane shell closes the herdr pane and ends the
   agent.
2. The shell check compares `comm` to `zsh`, `bash`, ...; a login shell's
   `comm` and argv0 are `-zsh`, so the pane shell was never recognised as a
   shell. (`tree-holders.ts` already strips the dash; the kill module does not.)

Also, macOS `ps -o comm=` truncates to 16 characters (`/Users/matt/.loc`),
which is why the log labels read `.loc` and `.bun`.

## Goals

- An agent session that started in tree A and moved to tree B survives A's
  disposal, together with its pane shell and every process it started, even
  those whose cwd is still in A. This holds for every disposal path and for
  the other two callers of the kill (reactor auto-return, triage "stop
  process").
- Workload still running in A that no live session owns (dev servers,
  watchers, test runners) is stopped exactly as today.
- When the merge reactor disposes A (its PR merged; a closed PR only marks
  the tree disposable and never reaches this path), an agent
  session whose own cwd is still inside A is stopped deliberately and named
  in the daemon log and in its own chat rooms (decided: "Stop it and name
  it", limited to the merge reactor).
- Every other disposal (manual `rt worktree dispose`, the `worktree_dispose`
  MCP tool, console triage, replenish shrink, stale-claim sweep) spares every
  agent session, as today (decided).

## Non-goals

- Deferring a dispose because an agent sits in the tree (considered and
  rejected; see Approaches).
- Changing which trees get disposed, the dispose guards, or the reactor's
  live-cwd gates.
- Changing `tree-holders.ts`, `lib/notifier.ts` or the stale-orphan stop
  path. The exports they import (`agentSessionPids`, `isUserOrAgentProcess`,
  `attributeCwds`, `safeRealpath`) stay with their current behaviour.
- Changing the rt-worktree skill's Finish flow or the MCP tool.

## Anti-goals

- Presence, the Claude pid registry or herdr deciding who lives. They only
  supply a name and rooms. A missing or stale identity falls back to pid and
  command and never changes who is stopped.
- Any test or manual check signalling a real process or touching the real
  `~/.mattstack`.

## Approaches

1. **Full process table, agent cwd decides.** One `ps -A` snapshot plus the
   full lsof cwd map; every agent anywhere is a session root; its family is
   its ancestors and descendants; the agent's own cwd says where the session
   is.
2. **Presence and herdr panes decide.** Rejected: misses agents not signed in
   to chat, and fails open when presence or herdr is stale.
3. **Process table decides, presence only names it** (picked by the shepherd
   for Matt). Option 1's safety, plus Claude's pid registry and chat presence
   to name a stopped session and find its rooms.

For an agent still inside A, the shepherd picked "stop it and name it" over
"hold the dispose while one sits there" and "spare every agent and dispose
anyway", then limited stopping to the merge reactor over "every dispose,
spare the requester" and "every dispose, no exception". The limit exists
because the rt-worktree Finish flow has an agent call `worktree_dispose` on
its own tree from inside it, and the MCP tool sends no caller pid.

## Known effects

- An agent that merges its own PR while sitting in the PR's tree is stopped
  when the reactor disposes that tree. Accepted by the decision above.
- When an agent is stopped, its descendants (MCP servers, a dev server it
  started) are not signalled by rt; they exit with the agent or are left as
  orphans in the trashed directory, the same as today for an agent's
  children. A later pass of the existing stale-orphan path handles leftovers.

## Design

### 1. Kill planning (`lib/daemon/worktree-process-kill.ts`)

A new pure planner drives `killWorktreeProcesses`:

```
planWorktreeKill({
  target, excludes,           // realpath'd, as today
  table: ProcRow[],           // every process: pid, ppid, comm, args
  cwds: Map<number, string>,  // every process's realpath'd cwd from lsof
  protectedPids,              // the daemon, its parent, the calling CLI
  stopSessionsInside,         // true only for the merge reactor's dispose
}) => { targets: KillCandidate[]; stoppedSessions: { pid; label; cwd }[] }
```

- **Names.** A process answers to its `comm`, its argv0 basename and, for an
  interpreter, its script's basename, each with a leading `-` stripped (login
  shells). The existing agent, shell and spared-binary sets apply to those
  names. Labels use the argv0 basename, not the truncated `comm`.
- **Protected roots.** `protectedPids` minus pid 0 and pid 1. The daemon runs
  under launchd, so `process.ppid` is 1, and pid 1's descendants are every
  process on the machine: treating it as a root would spare everything.
  Each remaining protected pid spares itself and its descendants, and also
  every agent session that is its ancestor (with that session's whole
  family): the caller of `rt worktree dispose` is the `rt` pid, whose
  ancestor is the agent that ran it.
- **Sessions.** Every process in `table` whose names match an agent
  (`claude`, `codex`, ...) is a session root. Its family is the root, every
  ancestor up to but excluding pid 1, and every descendant.
- **Where a session is.** A root is inside A when its own cwd is inside A and
  not under a nested excluded tree (same rule as `attributeCwds`). A root
  with no known cwd counts as outside.
- **Spared.** Every member of a family whose root is outside A, every family
  spared through a protected pid, and the protected pids with their
  descendants. Spare wins: a process in any spared family is never a target,
  even when it also belongs to a family being stopped.
- **Stopped sessions.** With `stopSessionsInside`, each root inside A that is
  not in a spared family becomes a target and a stopped session. Only the
  agent process is signalled; its pane shell stays (a shell), and its
  descendants are not targets. Without `stopSessionsInside` every session is
  spared, which is the module's promise today.
- **Workload.** Targets are the processes attributed to A (cwd inside A, not
  in a nested tree) that are not spared, not in a stopped session's family,
  not a shell, not a spared binary, and not inside an `.app` bundle. This is
  today's rule with the family protection widened.

`killWorktreeProcesses(path, opts)` gathers the inputs, resolves identities
and signals:

- `lsof -d cwd -Fpn` parsed in full by a new parser (or a variant of
  `parseLsofCwdMap` that takes no prefix filter) for `cwds`; one
  `ps -A -o pid=,ppid=,comm=,args=` for `table`. Either tool failing skips the
  kill with a warn, as today: nothing is signalled.
- New option `stopSessionsInside?: boolean` (default false) and an injectable
  `identify?: (pid) => SessionIdentity | null` (section 2).
- **Identity is resolved before any signal.** For each planned stopped
  session the kill calls `identify(pid)` first, because Claude's
  `<pid>.json` registry entry is likely gone once the agent exits. The
  identity rides on the result.
- Signals and escalation are unchanged: SIGTERM all targets, SIGKILL the
  survivors after 5s on an unref'd timer.
- Result: `{ terminated, stoppedSessions: { pid, label, cwd, identity }[] }`.
- The module's header comment is updated to state the new contract.

### 2. Naming a stopped session

```
identifySession(pid) => { sessionId: string; handle?: string; pane?: string; rooms: string[] } | null
```

`sessionForPid(pid)` (`lib/claude-registry.ts`) gives the session id;
`presenceForSession` gives handle and pane; `listRooms(handle)` gives the
open rooms. Each step failing or coming back empty returns what it has
(null when there is no session id); the display name then falls back to
`pid <n> (<label>)`. Any thrown error is caught, logged at warn, and treated
as null. It lives in a new file under `lib/daemon/` next to the kill module
and imports stores, never chat handlers.

### 3. Reporting (`lib/worktree/dispose.ts`)

- `disposeTree` opts gain `stopSessions?: { why: string }`. Only the merge
  reactor passes it, with `why` naming the PR and its state (for example
  `PR #1087 merged` on GitHub, `MR !42 merged` on GitLab; the iid comes
  from the branch's entry in the reactor's bare-branch-scoped cache map, the
  same lookup `disposeTree`'s `joinedMr` does).
  Its presence sets `stopSessionsInside: true` on the kill; its `why` goes
  into the chat line.
- `DisposeDeps` gains `notify?: (post: { room: string; body: string }) => Promise<void>`
  and a test seam for the kill call (default `killWorktreeProcesses`).
- For each stopped session, `disposeTree` logs one `warn` line with repo,
  tree, pid, label, and session id, handle and pane when known:
  `stopped agent session <name> working inside <tree>`.
- After the tree is retired (so the trash path is known), for each stopped
  session with rooms it calls `notify` once per room. The body names the
  session, the disposed tree, the `why`, and the trash path, in rt's plain
  copy style; exact wording is the builder's. The post carries no mentions,
  so it records the line in the room without waking anyone (rooms default to
  wake-on-mention); that is enough for "nobody reports a dead agent as
  working".
- A notify failure logs a warn and never fails the dispose.

### 4. Wiring

- `ReconcilerDeps` (`lib/daemon/worktree-reconciler.ts`) gains an optional
  `notify`, passed into `ReactorDeps` and from there into the reactor's
  `DisposeDeps`. No other dispose path needs it, since only the reactor stops
  sessions.
- `lib/daemon.ts` (approved fence exception, wiring only): the
  `createWorktreeReconciler` call passes a `notify` that calls
  `routedHandlers["chat:post"]` with `handle: SYSTEM_HANDLE` (`herdr`),
  late-bound so construction order does not matter. Stay clear of the
  run-outcome refresher area another lane is editing.

## Testing

All tests use fake `ps`/`lsof` rows, a stub resolver and a stub notify;
nothing signals a real process.

- Planner, replaying the incident: agent root cwd in B, its pane shell `-zsh`,
  `.bun` and `.loc` children with cwd in A, plus an unrelated dev server in A.
  Only the dev server is a target, with or without `stopSessionsInside`.
- Login shell `-zsh` with no agent is spared.
- `protectedPids` containing 1 (the daemon's real `ppid`) does not spare an
  unrelated dev server in A.
- A protected caller pid whose ancestor is an agent inside A: that agent is
  not stopped even with `stopSessionsInside`.
- Agent with cwd in A and `stopSessionsInside: true`: the agent is a target
  and a stopped session; its pane shell and children are not targets.
- Same with `stopSessionsInside: false`: nothing of the session is a target.
- Spare wins: an agent in A that descends from a moved session is not
  stopped.
- Unknown agent cwd counts as outside.
- Protected pids, nested excluded trees, `.app` bundles: as today (existing
  tests keep passing).
- `killWorktreeProcesses` with injected spawn results: lsof or ps failing
  signals nothing; `identify` is called before the signal step.
- `disposeTree` with a stubbed kill and notify: with `stopSessions`, one warn
  per stopped session and one notify per room after retire, the body naming
  tree, `why` and trash path; a session with no identity is logged by pid and
  posted nowhere; a throwing notify does not fail the dispose.
- Manual dispose pinned: `disposeTree` without `stopSessions` calls the kill
  with `stopSessionsInside` false and never notifies.
- Reactor: a merged-MR dispose passes `stopSessions` with the PR's iid and
  state.

## Left to the builder

- File names for the resolver and planner types within the fence.
- Exact log and chat wording.
- How spawn results are injected into `killWorktreeProcesses` for its tests.
