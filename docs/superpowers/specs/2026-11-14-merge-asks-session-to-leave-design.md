# A merged PR asks the session to leave its worktree (RT-576)

## Why

When a PR merges, the daemon disposes the PR's worktree and SIGTERMs every
Claude session whose working directory is inside it
(`lib/daemon/reconciler/reactor.ts`, `disposeTree(..., { stopSessions })`;
`lib/daemon/worktree-process-kill.ts`). That ends sessions a person is
driving. On 2026-11-14, merging #1144 ended the session that built it.

The kill exists for a reason (RT-345): a session left in a disposed tree
keeps the recycled path as its directory, and its next git command lands in
whoever claims that tree next. That session was also resumed straight back
into `celeborn` after another session had claimed it.

Matt wants the session asked, not killed, with the choice made in the pane.

## Goals

- On a merge, a live session inside the tree sees a kit question in its
  pane naming the merged PR: **Close session** or **Exit worktree and
  continue**.
- No answer within 2 minutes: the session exits the worktree and continues.
- A session sitting in a tree that has already been provisioned to another
  owner exits it at once, with no question. This includes a session
  resumed into a recycled tree.
- No session ever runs a git command inside a recycled tree (RT-345 stays
  closed).

## Non-goals

- No gate: nothing is recorded, nothing reaches the board, no agent is
  woken by a doorbell. Matt chose a mod question over a gate.
- No change to herd job trees: they are held until their owner releases
  them (`jobHold`) and are not on this path.
- No change to parking, cleanup or triage disposals; only the merge path
  stops sessions today, and only it changes.

## Anti-goals

- A tree left claimed forever because a session ignored the question.
- A session that "left" by `/cd` but is still marked as inside a worktree:
  after a `/cd`, Claude Code's worktree isolation still refuses every Bash
  command until ExitWorktree runs (seen live on 2026-11-14).

## Approaches

- **A, picked: the daemon marks the tree as leaving and waits.** The mod
  watches its own tree through a long-poll verb and asks when the mark
  appears. The daemon disposes once no live agent session is inside, or
  after a grace period with today's kill. Sessions without the mod are
  covered by the fallback for free.
- **B: the daemon messages each session and waits for a reply.** Needs a new
  two-way channel and per-session tracking just to learn whether the mod is
  there. Rejected: more to build for nothing A lacks.

## The design

### Daemon (merge path)

When the reactor would dispose a merged `ephemeral` tree:

1. Plan the kill as today, without signalling (the planner in
   `worktree-process-kill.ts` already finds agent roots whose own cwd is
   inside the tree). No live agent session inside: dispose exactly as today.
2. Otherwise mark the tree as leaving on its record (new field on
   `TreeRecord`, `lib/worktree/registry.ts`, carrying the reason text the
   reactor already builds, e.g. "PR #1144 merged", and when the mark was
   set) and do not dispose yet. The tree stays claimed and is never handed
   out while marked.
3. Each reconcile pass re-plans: once no live agent session is inside,
   dispose as today (workload processes are still killed).
4. Grace: 3 minutes after the mark (2-minute question plus slack for the
   exit to land), dispose with today's `stopSessions` kill and chat notice.
   That is the fallback for a session with no mod, a stuck mod, or a
   session that ignores the question past its own timeout.

### Verb

A hidden long-poll verb for the mod, modelled on `rt gate wait` (daemon
clamps each wait, the CLI loops; a daemon restart mid-wait is not an
error): `rt worktree await-leave <path>`. It returns as soon as the tree at
`path`:

- is marked leaving: `{ state: "leaving", why, mainCheckout }`, where
  `mainCheckout` is the repo's main working tree path;
- is not a live tree for this session any more (see Reclaimed below):
  `{ state: "reclaimed", mainCheckout }`;
- is not an rt tree at all: `{ state: "none" }` (the mod stops watching).

### Mod (mattstack plugin, beside `enter-worktree-check.ts`)

- On session start (including resume) and whenever the session's directory
  changes into an rt tree (`rt worktree is-registered` says `registered`),
  start watching that tree with `rt worktree await-leave`. One watcher per
  session; a directory change out of the tree stops it.
- `leaving`: show the kit question in the pane. Title names the reason
  ("PR #1144 merged"). Two choices:
  - **Close session**: `$.command.run({ command: "exit" })`.
  - **Exit worktree and continue**: leave (below), then a one-line note in
    the transcript naming the reason and the new directory.
- No answer in 2 minutes: leave, with the same note, and close the question.
- `reclaimed`: leave at once with no question; the note says the tree was
  reused.
- **Leaving** means: `$.tool.call({ tool: "ExitWorktree", action: "keep" })`
  first (clears Claude Code's isolation; `keep` does not fire rt's
  WorktreeRemove hook). ExitWorktree is a no-op for a session that started
  in the tree or was resumed there, so then
  `$.command.run({ command: "cd", args: mainCheckout })`. Both run once the
  session is idle (`$.command.run` queues); a turn in progress finishes
  first, inside the 3-minute grace.

### Reclaimed

A session is in a reclaimed tree when the tree's current claim began after
the session was last inside it legitimately. The cases that must count:

- the session was killed or asked to leave at a disposal, then resumed
  into the recycled path (the daemon already resolves each stopped
  session's id at kill time, `stoppedSessions` in `dispose.ts`, and can keep
  "session S was inside tree T when it was disposed");
- the session was closed, the tree disposed and re-claimed, and the session
  resumed later.

How the daemon tells (records of sessions present at disposal, claim
timestamps against the session's transcript activity, or both) is left to
the builder; the verb only reports `reclaimed`.

### Where the question is drawn

The question uses the mod kit's form look (the gate forms' kit). The
mattstack plugin already depends on `gate-form`. Builder's call between:
gate-form adding a small noun to `$` for other plugins (a plugin contract,
`types/index.d.ts`) that opens a kit question and resolves with the pick
or a timeout; or moving this mod under `mods/` so it bundles mod-kit
itself. My lean is the gate-form noun: one form implementation, and the
dependency already exists.

### Settled after the builder check

- **The question does not depend on `rt.gates.kitForm`** (my call). That
  setting gates the gate kit forms, which are still a prototype; this is
  not a gate. Today gate-form registers nothing with the setting off, so
  whichever host is picked must open the question with the setting off.
- **Leaving moves the real working directory, which is what the daemon
  reads** (`lsof -d cwd` in the kill planner). Checked live: after
  EnterWorktree, this session's `claude` process had its cwd in the new
  tree. The first plan task confirms the same for `ExitWorktree keep` and
  `/cd`. If either leaves the process cwd behind, the mod also tells the
  daemon it has left (a small ack verb), and the daemon trusts that.
- **A departed session's own processes still in the tree are killed at
  dispose** (my call). Today the planner spares the whole family of an
  agent outside the tree, so a dev server the session started would keep
  running in the trashed directory and holding its ports. On this path
  only, once no agent session is inside, dispose kills every non-agent
  process whose cwd is inside the tree, whoever its parent is. Other
  disposal paths keep today's rule.
- **The leaving mark drives its own re-checks and grace timer**: after the
  first reconcile pass records the merge, later passes take a path that
  never disposes, so the mark can't rely on the merge edge firing again.
- **The mark is set after `disposeTree`'s guards** (dirty, unpushed,
  running run, grace), where the kill sits today, so a tree those guards
  hold is held as before.
- **`await-leave` takes the session id**, so the daemon can report
  `reclaimed` for that session.

## Constraints

- No setting gates it: it replaces the kill outright (my call; Matt asked
  did not mention a setting).
- The 3-minute grace is my call, sized to the 2-minute question plus time
  for a running turn to end.
- A pane opened unasked is placed only from 144 columns (110 once asked),
  and focus goes only to an open the person asked for: the question may
  not be visible or focused in a narrow pane. The 2-minute timeout covers
  that; the board band pattern (`bandAbovePrompt`) can show it above the
  prompt like the gate forms do.
- The mod can't receive Escape; the question needs no Escape path.
- Run only targeted tests locally (repo rule); mods tests via
  `bun run mods:test`, plugin harness via `claude plugin test`.

## Left to the builder

- The exact TreeRecord field name and shape, and the event the reactor
  emits for it.
- How "reclaimed" is detected (above).
- The question's copy beyond the two choice labels Matt named.
- Whether the gate-form noun or a `mods/` move hosts the question.
