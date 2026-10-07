# Harness integrations: the Claude side on Claude Code mods

Status: design for review, 2026-10-07. This document amends
[the harness integrations design](2026-10-04-harness-integrations-design.md).
Where the two disagree about Claude's mechanisms, this one wins. It changes
no shared contract, no Codex behavior and no shared service.

## Purpose

Claude's side of the harness-neutral layer moves onto Claude Code mods,
including the Claude adapters already built. Today's outside-in mechanisms
(the inbox doorbell, Escape, screen reads, shell hooks, key presses) stay as
the fallback for any session or feature the mod does not cover.

Success means:

- every Claude adapter contract has a mod path, proven live in a real pane;
- each feature falls back to today's path on its own when its mod part is
  absent, unlinked or failing, and that fallback passes today's tests;
- with `agent.integrations.enabled` off, nothing loads and behavior is
  today's bytes and timing;
- older Claude Code, `claude -p`, Codex panes and sessions outside the tested
  Claude Code range behave as today.

## Decisions this design rests on

Matt made these choices on 2026-10-07; they are not open here.

1. Every Claude-side task in the project moves to mods, including the
   finished adapters. Today's mechanisms stay as the fallback.
2. Scope is the Claude Code mods project, with the extras checked one by
   one (see Scope).
3. The abilities the tickets assumed were proven by two spikes before this
   spec was written.
4. The mods ship as one plugin, separate from the mattstack plugin, which
   setup installs only while `agent.integrations.enabled` is on.
5. One plugin holds the core and every feature as an internal block.
6. A new mods package runs before M6. Tasks not built yet (M6, H3, H4, H6,
   S5) take their mods tickets into their own text and are built mods-first.
7. Fallback is per feature, chosen from what the mod reports for the
   session.
8. Each mods task is verified by unit tests against a fake `$`, `claude
   plugin test` in CI, and a live check in a dedicated `--plugin-dir` pane
   under Matt's login in a throwaway repo. Matt's dev-app trial stays the
   final end-to-end check.
9. RT-390's reply rule is an always-on prompt section (see Delivery).

## Evidence

Both spikes ran Claude Code 2.1.293 under Matt's login with his plugins.

[mods-01](../spikes/2026-10-07-mods-01-results.md) (RT-383):

- `ui.render` hides a row; the model still reads it.
- `session.receive` consumes a delivery before the model. The delivery's
  origin is `peer`.
- A `tool.call` hook can hold AskUserQuestion for minutes, but only through
  chained `events:wait` rounds of 25 s or less carrying a cursor.
  `$.http.fetch` is cut off at 30 s. After a daemon restart (ECONNRESET) the
  mod retries with the cursor it holds.
- The hook can return its own result while the built-in dialog is up, which
  closes the dialog. Prefilled answers are ignored.
- `$.session` id, cwd and root work. In worktree hooks use `root()`, since
  `cwd()` lags. `/clear` changes the session id.
- `rt.sock` is reachable through `$.http.fetch` with `socketPath`, and
  `HERDR_PANE_ID` is visible. No per-session socket is needed.
- A `$` noun added by one plugin is callable from a dependent plugin.
- The inbox envelope is the daemon's push path (2 to 4 ms, mid-turn too).

[mods-02](../spikes/2026-10-07-mods-02-results.md):

- An allow from `tool.check` on EnterWorktree skips the relocation prompt
  for that path; a pass-through leaves the prompt up. No grant is remembered.
- `$.prompt.submit` starts a turn from an idle session (50 to 75 ms). The
  model sees it labelled as a plugin message unless `asUser` is set.
- `$.turn.abort` ends a running turn in about 40 ms. A running Bash command
  is not killed: it moves to the background, and its completion starts a new
  turn.
- A `prompt.compose` section reaches the model only if it is present when a
  conversation starts. Changes mid-conversation never reach the model, even
  after `/compact`.
- A `classic.Stop` hook returning a block reason holds the turn open with
  the reason shown to the model, and lets it end once the condition clears.

## Scope

In scope (19 tickets):

| Ticket | What it gives Claude | Where it lands |
| --- | --- | --- |
| RT-384 | The core plugin and `$.rt` | Mods package |
| RT-405 | Daemon `session:*` handlers on F3's store | Mods package |
| RT-406 | Daemon link and session context | Mods package |
| RT-407 | Tool-call policy registry | Mods package (core), used by M6 |
| RT-408 | Incoming delivery router | Mods package |
| RT-409 | In-session display kit | Mods package |
| RT-410 | Prompt sections | Mods package |
| RT-386 | Chat delivery rows hidden on screen | Mods package |
| RT-390 | Reply rule stated once | Mods package |
| RT-389 | Presence from session events | Mods package |
| RT-387 | Chat sign-in through the session | Mods package |
| RT-385 | The mod owns the gate form | Mods package |
| RT-402 | Wait gates without `rt gate wait` | Mods package |
| RT-391 | Shell hooks ported | M6 (stop gate, spill note), H6 (announce) |
| RT-395 | Session state feed | H3 |
| RT-397 | Watchdog reads the feed, nudges in session | H3 |
| RT-396 | Run liveness, stop gate, runDb | H4, M6 |
| RT-400 | Relocation answered in session | H6 |
| BOARD-52 | Board status and stand-down | S5 |

Out of scope, kept as optional work in the mods project: RT-392, RT-393,
RT-399, RT-401, RT-403, RT-404, SKILLS-96. RT-398 was canceled (Flock's
hover card was removed). RT-394 is a duplicate.

## Architecture

### The plugin

`plugins/mattstack-mods` lives in this repo beside `plugins/mattstack`. It
has its own CI job (`claude plugin validate`, `claude plugin test`, its unit
tests) and its own version-bump check.

Setup installs it when `agent.integrations.enabled` is on and removes it
when the switch is off. The install is an update-safe setup step and follows
the existing rules: idempotent, never overwriting what the user chose, and
leaving alone a plugin the user disabled or removed.

### The core block

The core adds `$.rt`. Feature blocks register onto it and never hook the
engine themselves.

- **Daemon link (RT-406).** At session start the core calls
  `session:register` over `rt.sock` with the session id, cwd, `root()`,
  `HERDR_PANE_ID`, Claude Code version, plugin version and the blocks that
  started. It re-registers when `/clear` changes the id and reports the end
  of a session.
- **Push.** Daemon commands arrive as inbox envelopes, which the core
  consumes in `session.receive` and routes to the block's handler.
- **Waits.** A long wait is a chain of `events:wait` rounds of 25 s or less
  that carry a cursor. A dropped round retries with the same cursor.
- **Session context.** The core keeps a context record in `$.state`
  mirroring what the daemon resolved. It is a hint to the shared resolver
  and never grants authority.
- **Hooks it owns.** The only `tool.call`/`tool.check` hook (the policy
  registry, RT-407, in the order fill, guard, permit, call, tap), the only
  `session.receive` hook (the delivery router, RT-408), the display kit
  (RT-409) and the prompt sections (RT-410).

### The daemon side (RT-405)

`session:*` handlers write into F3's session store. There is one registry.

A registration records the session's mod blocks on the Claude session
record: `delivery`, `gate-form`, `gate-wait`, `presence`, `policy`,
`stop-gate`, `relocation` and `observe`. These are Claude-internal; the
shared `Capability` vocabulary does not change. A block counts as live only
while the link is: a missed heartbeat, a session end or a refused
registration clears every block for that session.

### The adapters

Each Claude adapter keeps its contract. Before acting, it checks whether its
block is live on the binding's session. If it is, it takes the mod path;
otherwise, today's path. Codex adapters and the shared stores are
untouched.

## Feature design

### Sessions and attribution (F3, F4; RT-405, RT-406)

The link's register, report and end become the Claude lifecycle source,
written into the same session store with the same key and generation rules.
`/clear` re-registers under the new id. The context record feeds the shared
caller-context resolver, which checks it against the live link. Without a
link, today's claude-registry, shell-hook lifecycle and environment and
ancestry resolution apply.

### Delivery (M1, M2; RT-408, RT-386, RT-390)

The inbox writer stays the transport. The router recognises rt's wrapped
deliveries and reports each one under its delivery id when it hands it to
the model. That upgrades the receipt from `submitted` to `consumed`, the
evidence value Codex already uses.

Chat delivery rows are hidden on screen (RT-386). The model still reads
them, and ctrl+o shows them.

The reply rule (RT-390) is a prompt section present in every session with
the mod. Because a section is fixed when a conversation starts, the router
trims the Claude-only half of the per-delivery reply line ("never
SendMessage") only in conversations that started with the section. The
shared half (who sent it and how to reply) stays in every delivery, so
Codex deliveries and Claude sessions without the section are unchanged.

### Presence and sign-in (M3; RT-389, RT-387)

The presence block reports turn start, turn end and session end to the
shared presence service, replacing the chat heartbeat and the session-end
shell hook for that session.

Sign-in stays manual. The Flock button, `/chat:sign-in` and `rt chat
sign-in` send a sign-in command down the link, and the mod signs in with
its own session id and `root()`, so the room follows EnterWorktree and
survives `/clear`.

### Gates (M5a; RT-385, RT-409, RT-402)

**A form the session asks itself.** The core's `tool.call` hook on
AskUserQuestion opens or links the gate, then lets the built-in dialog
show. While it is up, the block waits on the gate in rounds. The first
answer wins:

- An answer in the pane goes through as usual and is recorded on the gate
  as a pane answer.
- An answer from elsewhere is committed by the gate service first. The
  block then reads the row back, to learn who won the race, and returns
  that answer as the tool's result, which closes the dialog.
- A superseded gate closes the dialog with a withdrawn result.

Sessions with `gate-form` live get no doorbell, no Escape and no screen
read, and the leftover "[gate] answered" rows are hidden. The display kit
is used only where the dialog cannot be shown. Herd workers keep
wait-on-gate as today.

**Wait gates.** When `gate_ask` opens a wait gate for a session with
`gate-wait` live, its reply says the session will be woken. The block waits
in rounds and, once the gate is answered, starts a turn with
`$.prompt.submit`, labelled as a plugin message. Claude's wait fragment
branches on that reply; shared skill text names no Claude-only mechanism.
Without the block, skills run `rt gate wait` as today, and the
`Bash(rt gate *)` and `Bash(rt events wait *)` allow rules stay.

**Completion record.** A gate completed through the mod gets the same kind
of completion record M4 keeps, naming the winner and the path (`mod-result`
or `doorbell`).

### Policy (M6; RT-407, RT-391, RT-396)

Gate and continuation rules live once in the daemon. Claude enforces them
through the policy registry; Codex through its preToolUse and Stop hooks, as
already planned.

For a session with `stop-gate` live, the pipeline Stop gate is a mod
`classic.Stop` that blocks with a reason. The shell `pipeline-gate-stop.sh`
asks for the session's blocks and stands down when the mod owns the gate.
That check runs only with the switch on.

The spill-read note becomes a prompt section. The time stamp stays a shell
hook, because a prompt section is frozen per conversation. It moves only if
the API offers a per-turn way to add context.

### Supervision (H3; RT-395, RT-397)

The `observe` block reports turn start and end, a question form on screen,
background work running and session end into the shared observation store.
H3 reads that store for every harness. Watchdog nudges to a session with
the block live are mod commands that end in `$.prompt.submit`, not keys
typed into the pane.

### Runs (H4; RT-396)

Run liveness comes from observations, so a working session is never marked
stale. The policy registry's fill step adds `runDb` to `run_*` calls. The
stop gate is the one in Policy. A session end marks the running stage
abandoned.

### Worktree relocation (H6; RT-400, RT-391)

For a session with `relocation` live, `tool.check` on EnterWorktree asks the
daemon whether the path is a registered rt worktree and allows it. There is
no announce, no screen parse and no key press. Any other path still gets
Claude Code's prompt. The daemon's three key-pressing seams stand down for
these sessions; `trust-dialog.ts` stays for the rest.

### Board (S5; BOARD-52)

A status tool replaces the `status-bin` Bash calls. Stand-down is a consumed
delivery that runs `$.turn.abort`. Since a running Bash command survives the
abort and later starts a turn, S5 begins with a short API check for ending
or absorbing that backgrounded work. If there is no way, the board shows
"stood down; background work finishing" until it ends.

## Failure handling

- **Errors inside a block** pass the call through, as if the mod were not
  there, and clear that block for the session.
- **No link** (daemon down, restarting, unreachable) clears every block, and
  each adapter takes today's path. The link retries with its cursor. Shell
  hooks stop standing down as soon as a block clears, so the stop gate never
  has a gap.
- **Unconfirmed commands.** The mod confirms each daemon command (complete a
  gate, nudge, sign in, stand down) under its id. An unconfirmed command
  falls back once, for that action only, and the record says which path
  completed it.
- **Switch flips.** Turning the switch off removes the plugin, and the
  daemon refuses `session:register`, so mods still loaded in running
  sessions find no link and pass everything through. Turning it on takes
  effect for sessions started after the install.

## Claude Code versions

The mods API is early access; its types already moved packages between
2.1.291 and 2.1.293. The plugin declares a minimum Claude Code version, and
the daemon keeps the range it has tested. A session outside that range
registers but gets no blocks, so everything falls back, and diagnostics say
why. Only a test run (the plugin tests plus a pane check) widens the range.

`rt agent integrations` shows each Claude session's link state and live
blocks, and reports Codex's `experimentalApi` use, which closes the spec
gap carried from M5c.

## Testing

- Each block: unit tests against a fake `$`, `claude plugin test` in the
  plugin's CI job, then a live check in a `--plugin-dir` pane under Matt's
  login in a throwaway repo.
- Each feature: a fallback test (block cleared, today's exact bytes, frozen
  fixtures untouched) and an unconfirmed-command test (falls back once,
  records the path).
- Daemon: contract tests for `session:*` and the block lifecycle (register,
  heartbeat, `/clear`, end, switch off refuses).
- Matt's dev-app trial is the final end-to-end check.

## Documents and tickets

- The main spec's mods paragraph points here, and its "Claude adapters
  first wrap today's mechanisms" sentence is removed.
- A new package plan for the mods work runs before M6. The plan index's
  "Existing work and completion" section gets this design's scope table and
  out-of-scope list, and loses the wrap-first sequencing paragraph. M6, H3,
  H4, H6 and S5 gain their mods tickets in their own text.
- After this spec is approved, each in-scope ticket's "Harness
  integrations" paragraph is rewritten to match it, without the wrap-first
  wording and with the spike facts that matter to it. RT-389 gains RT-406 as
  a blocker. RT-384 gets a comment with the mods-02 results. No new tickets.

This document authorizes no implementation. The plan revision follows its
approval.
