# Herd watchdog follow-up rounds and form-only gate Escape

Tickets: RT-355 (watchdog nags a done job mid follow-up), RT-357 (gate-push
Escape interrupts herd workers). Two independent daemon fixes in one branch.

## Problem

**RT-355.** A job that reported done often takes a follow-up round from the
shepherd in the same pane. The watchdog still nags "done, not closed" through
that round, for three reasons:

1. `herd-lifecycle.ts` `reconcilePanes` only keeps a status subscription for
   panes whose job status is in `WATCHED` (`spawning`, `active`, `at-gate`,
   `at-milestone`, `stuck-at-modal`). Once a job goes `done` its subscription
   is dropped within one reconcile tick, so `lastStatusChange` never moves
   again and `openReportAges` never sees post-report activity.
2. A pane that ended its turn to wait on a background shell or a `Monitor`
   reads `idle` to herdr. herdr already reports a turn waiting on background
   subagents or MCP tasks as `working` (its `background_agents_working` and
   `background_mcp_task_working` rules), but shells and monitors only show in
   Claude Code's footer.
3. Nothing but a close clears the nag, so it repeats every retry interval.

**RT-357.** `gate-push.ts` `pushToPane` sends Escape after the doorbell for
every gate whose `origin.presentation` is `form`. `herd:ask` and
`herd:milestone` compute `form` whenever the questions fit the native form,
but a herd worker ends its turn instead of drawing one. The doorbell starts a
fresh turn at an idle prompt and the Escape then interrupts it, so a lane
stalls after every answered milestone.

## Design

### 1. Keep watching done-job panes (herd-lifecycle.ts)

`reconcilePanes` subscribes to panes of jobs in `WATCHED` **or** `done`.
`WATCHED` itself does not change: the blocked/idle room notices, the crash
path and `jobFor`'s preference for a live row all keep their current meaning.
`handleEvent` already records `lastStatusChange` and `recordPaneStatus` for a
done job's pane before any `WATCHED` check (`jobFor` returns the done row as
its `stale` hit), so re-subscribing is the whole fix. The existing
`pane.closed` path already moves a done job to `closed`.

With the subscription live, `openReportAges` keeps its current rule (restart
`quietMs` from `idleSinceMs` when that is newer than the report) and now
actually sees the transition.

### 2. Background work counts as working (adapters + watchdog)

New sensor on `WatchdogSensors`:

```ts
/** True when the pane's last reading showed Claude Code holding a background
    shell, monitor or subagent. */
backgroundWork(pane: string): boolean;
```

`createWatchdogSensors.refresh()` fills it: after the snapshot, for every
pane that reads `idle` and belongs to a job of an active herd (never the
shepherd pane), it does one `pane.read` (`source: "visible"`) and tests the
text with `hasBackgroundWork(screen)`, exported from the adapters file:

- Only the lines below the composer's last horizontal rule (a line of 10+
  `─`) are read, so conversation text that mentions "1 shell" never counts.
- A footer count: `/\b[1-9]\d* (?:shells?|monitors?)\b/` (captured footer:
  `⏵⏵ auto mode on · 1 shell, 1 monitor · ← for agents`).
- The agents panel: a `⏺ main` line followed by at least one other entry
  line (captured: `◯ general-purpose  Throwaway footer… 5s · ↓ 49.3k tokens`).

A failed read counts as no background work (the current behavior). Fixtures
in the adapter tests are the captured screens, not hand-drawn ones.

In `herd-watchdog.ts`:

- `openReportAges` returns null when `backgroundWork(pane)` is true, so a done
  job with a background task gets neither the finished-lingering nag nor the
  shepherd backstop.
- `evaluateJob` (live job, idle pane) keeps both fast paths (unread
  DMs/mentions, an answered gate left unconsumed): those are wedges whatever
  runs in the background. Background work only exempts the no-gate backstop.
- The shepherd evaluator is unchanged: shepherds routinely hold monitors, and
  a background task must never hide a human gate waiting on them.

### 3. The follow-up mark (`herd:follow-up`)

A shepherd-only verb that flips a `done` job back to `active`:

- **Daemon** `herd:follow-up { herd, job }` in `handlers/herd.ts`. Refuses an
  unknown job, a job not in `done`, and a job with no pane. Calls
  `setJobStatus(herd, job, "active")`, which keeps `lastReport` and stamps
  `updatedAt`. Returns `{ job, status: "active" }`.
- **rt-client**: payload/data types and the verb-list entry in
  `packages/rt-client/src/commands.ts`, a `herdFollowUp` wrapper in
  `client.ts`; `dist/` rebuilt, no version bump.
- **CLI** `rt herd follow-up <job> [--herd <id>] [--json]` in
  `commands/herd.ts`, a `follow-up` node in `lib/command-tree-def.ts`
  (`omitBehavior: { exempt: "agent-facing; the shepherd names the job" }`,
  like `close`), registered where `close` is.
- **MCP** `herd_follow_up { job, herd? }` in `lib/mcp/herd-tools.ts`, gated
  exactly like `herd_close` (refused in a worker pane, `requireShepherd`), and
  added to the `rt-herd` shell-form note.

Why `active` rather than a new status: every live-job mechanism already does
the right thing for a job in a round. The lifecycle watches it, and the
watchdog judges it as a worker, so it gets no done nag, and the worker
backstop (idle `backstopMins` with no open gate and no background work) is the
quiet backstop RT-355 asks for. The next `herd_report` sets `done` with a
fresh report. No store or schema change.

### 4. Escape only onto a form (gate-escape.ts, gate-push.ts, daemon.ts)

`gate-escape.ts` gains `createPaneStatusProbe()` returning
`(hints: PaneHints) => Promise<LivePane["agentStatus"] | null>`, built on the
same `snapshotPanes` + `resolveLivePane` the injector uses (null when herdr is
unreachable or no pane resolves).

`createGatePush` takes an optional `paneStatus` probe. `pushToPane` decides
Escape eligibility **before** the doorbell: presentation `form`, not
self-answered, and the probe reads `blocked` (herdr's state for a pane
holding an AskUserQuestion form). An idle, done or working pane gets the
doorbell only; so does a pane the probe cannot read, and a push with no probe
wired. The doorbell is sent either way, and Escape still only follows an
accepted doorbell. Probing before the doorbell matters: afterwards an idle
pane is mid-flip to working and the reading races.

`lib/daemon.ts` wires `paneStatus: createPaneStatusProbe()` beside the
existing `injectEscape: createEscapeInjector()` for `createGatePush`. The
retry passes stay doorbell-only.

## Testing (test-first, each)

- Lifecycle: a done job's pane stays subscribed across `reconcilePanes`, and
  its `agent_status_changed` moves `lastStatusChangeMs`.
- Watchdog: done job, pane went working then idle after the report, gets its
  quiet clock from that transition (existing sensor fakes); done job with
  `backgroundWork` gets no nag and no shepherd backstop; live idle job with
  background work gets no backstop but still gets the unread-DM fast path;
  RT-205 tests unchanged.
- Adapter: `hasBackgroundWork` on the captured footers (shell, shell+monitor,
  agents panel), on a plain idle footer, and on conversation text above the
  rule mentioning "1 shell"; `refresh` reads only idle job panes.
- `herd:follow-up`: done to active with `lastReport` kept; refusals for
  non-done, unknown and paneless jobs; MCP refuses in a worker pane and for a
  non-shepherd; `picker:check` passes.
- gate-push: form gate on a blocked pane gets doorbell then Escape; on an
  idle pane doorbell only (the RT-357 regression); probe null and probe
  unwired give doorbell only; the close path follows the same rule.

## Out of scope

- Detecting a follow-up round automatically (rejected: any stray wake would
  reopen a job).
- Screen-marker checks for the form itself; `blocked` is the signal.
- Changing `herdOrigin`'s presentation for herd gates.
