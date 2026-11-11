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
  those whose cwd is still in A.
- Workload still running in A (dev servers, watchers, test runners not owned
  by a moved session) is stopped exactly as today.
- An agent session whose own cwd is still inside A when A is disposed is
  stopped deliberately (decided: "Stop it and name it"), and named in the
  daemon log and in chat.

## Non-goals

- Deferring a dispose because an agent sits in the tree (considered and
  rejected; see Approaches).
- Changing which trees get disposed, the dispose guards, or the reactor's
  live-cwd gates.
- Changing `tree-holders.ts` or the stale-orphan stop path.

## Anti-goals

- Presence, the Claude pid registry or herdr deciding who lives. They only
  supply a name and rooms. A missing or stale identity falls back to pid and
  command and never changes who is stopped.
- Any test or manual check signalling a real process or touching the real
  `~/.mattstack`.

## Approaches

1. **Full process table, agent cwd decides** (base of the pick). One
   `ps -A` snapshot plus the full lsof cwd map; every agent anywhere is a
   session root; its family is its ancestors and descendants; the agent's own
   cwd says where the session is.
2. **Presence and herdr panes decide.** Rejected: misses agents not signed in
   to chat, and fails open when presence or herdr is stale.
3. **Process table decides, presence only names it** (picked by the shepherd
   for Matt). Option 1's safety, plus Claude's pid registry and chat presence
   to name a stopped session and find its rooms.

Separately, for an agent still inside A, the shepherd picked "stop it and
name it" over "hold the dispose while one sits there" and "spare every
agent and dispose anyway".

## Design

### 1. Kill planning (`lib/daemon/worktree-process-kill.ts`)

A pure planner replaces the rows-then-protect logic:

```
planWorktreeKill({
  target, excludes,           // realpath'd, as today
  table: ProcRow[],           // every process: pid, ppid, comm, args
  cwds: Map<number, string>,  // every process's realpath'd cwd from lsof
  protectedPids,              // the daemon, its parent, the calling CLI
  stopSessionsInside,         // true only for disposal
}) => { targets: KillCandidate[]; stoppedSessions: StoppedSession[] }
```

- **Names.** A process answers to its `comm`, its argv0 basename and, for an
  interpreter, its script's basename, each with a leading `-` stripped (login
  shells). The existing agent, shell and spared-binary sets apply to those
  names. Labels use the argv0 basename, not the truncated `comm`.
- **Sessions.** Every process in `table` whose names match an agent
  (`claude`, `codex`, ...) is a session root. Its family is the root, every
  ancestor up to but excluding pid 1, and every descendant.
- **Where a session is.** A root is inside A when its own cwd is inside A and
  not under a nested excluded tree (same rule as `attributeCwds`).
- **Spared.** Every member of a family whose root is outside A (or whose cwd
  is unknown), and the protected pids with their descendants. Spare wins: a
  process that belongs to any spared family is never a target, even when it
  also belongs to a family that is being stopped.
- **Stopped sessions.** With `stopSessionsInside`, each root inside A that is
  not itself in a spared family becomes a target and a `StoppedSession`
  `{ pid, label, cwd }`. Only the agent process is signalled; its pane shell
  stays (a shell), and its descendants are left to exit with it. Without
  `stopSessionsInside` (reactor auto-return of a main checkout, the triage
  "stop process" action) every session is spared as the module promises
  today.
- **Workload.** Targets are the processes attributed to A (cwd inside A, not
  in a nested tree) that are not spared, not a member of a stopped session's
  family, not a shell, not a spared binary, and not inside an `.app` bundle.
  This is today's rule with the family protection widened.

`killWorktreeProcesses` gathers the inputs and signals:

- `lsof -d cwd -Fpn` parsed in full (not prefix-filtered) for `cwds`; one
  `ps -A -o pid=,ppid=,comm=,args=` for `table`. Either tool failing skips the
  kill with a warn, as today (fail closed: nothing is signalled).
- Signals and escalation are unchanged: SIGTERM all targets, SIGKILL the
  survivors after 5s on an unref'd timer.
- The result grows `stoppedSessions` next to `terminated`.
- The module's header comment is updated to state the new contract.

### 2. Naming a stopped session

A small resolver, injectable for tests:

```
identifySession(pid) => { sessionId, handle?, pane?, rooms: string[] } | null
```

`sessionForPid(pid)` (`lib/claude-registry.ts`) gives the session id;
`presenceForSession` gives handle and pane; `listRooms(handle)` gives the open
rooms. Any step failing or empty returns what it has; the name then falls
back to `pid <n> (<label>)`. Builder's call where this lives
(`lib/worktree/` or next to the kill module), as long as it stays in the
write fence and never imports chat handlers.

### 3. Reporting (`lib/worktree/dispose.ts`)

- `DisposeDeps` gains `notify?: (post: { room: string; body: string }) => void | Promise<void>`
  and a test seam for the kill call.
- `disposeTree` calls the kill with `stopSessionsInside: true`. For each
  stopped session it logs one `warn` line naming repo, tree, pid, label,
  session id, handle and pane when known
  (`stopped agent session <name> working inside <tree>`).
- After the tree is retired (so the trash path is known), for each stopped
  session with rooms it calls `notify` once per room with a body that names
  the session, the disposed tree, why it was disposed (merged PR, stale
  claim, or manual dispose, from what `disposeTree` already knows) and the
  trash path. Exact wording is the builder's, in rt's plain copy style.
- A notify failure logs a warn and never fails the dispose.

### 4. Wiring

- `ReconcilerDeps` and the worktree handler's opts gain an optional
  `notify`, threaded into every `DisposeDeps` they build (merge reactor,
  stale-claim sweep, replenish shrink, manual and triage disposes).
- `lib/daemon.ts` (approved fence exception, wiring only): passes a `notify`
  that calls `routedHandlers["chat:post"]` with `handle: SYSTEM_HANDLE`
  (`herdr`), late-bound so construction order does not matter. Stay clear of
  the run-outcome refresher area another lane is editing.

## Testing

All tests use fake `ps`/`lsof` rows or a resolver stub; nothing signals a real
process.

- Planner, replaying the incident: agent root cwd in B, its pane shell `-zsh`,
  `.bun` and `.loc` children with cwd in A, plus an unrelated dev server in A.
  Only the dev server is a target.
- Login shell `-zsh` with no agent is spared.
- Agent with cwd in A, `stopSessionsInside: true`: the agent is a target and
  a stopped session; its pane shell is not; its children are not.
- Same with `stopSessionsInside: false`: nothing of the session is a target.
- Spare wins: an agent in A that descends from a moved session is not stopped.
- Unknown agent cwd counts as outside.
- Protected pids and descendants, nested excluded trees, `.app` bundles: as
  today (existing tests keep passing).
- `killWorktreeProcesses`: lsof or ps failing signals nothing.
- `disposeTree` with stubbed kill, resolver and notify: one warn per stopped
  session, one notify per room after retire, the body names tree, reason and
  trash path; a session with no identity is logged by pid and posted nowhere;
  a throwing notify does not fail the dispose.

## Left to the builder

- File placement of the resolver and planner types within the fence.
- Exact log and chat wording.
- Whether `KillCandidate` is extended or a new `ProcRow` type is added.
