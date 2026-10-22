# The board defers to a live work run

## Why

On !4127 a work pipeline worker (Pip) was making final changes from a
review when the board saw CI failing and launched an auto doctor (Wren).
Both were about to commit and push to the same branch. Matt caught it, signed
both into rt chat, had the doctor message the worker, and the doctor stood
down. That fixed it, but only because a person noticed.

The board already refuses to launch a doctor when someone else holds the MR's
CI lease (`apps/board/src/triage/run.ts`, the `lease.holder !== 'doctor'`
skip). A worker only holds that lease during watch-ci. From implement through
ship, nothing on the branch says "taken", so the board reads it as
unattended.

The data to see the worker mostly exists: a run summary carries its branch,
status, current stage and a liveness probe naming the herdr agent
(`lib/runs/liveness.ts`). The daemon can already push a framed message into
any Claude session's inbox by session id, without chat (the gate doorbell in
`lib/daemon/gate-push.ts`; chat receipts in `lib/daemon/handlers/chat.ts`).

## Goal

When the board would launch an auto doctor for an MR, and a live work run
owns that MR's branch, the board launches nothing and rings the worker
instead. The worker folds the fix into the work it is already doing.

Success: the !4127 situation resolves with no person involved and no doctor
pane.

## Non-goals

- Auto-signing every session into rt chat. Worth doing on its own; this
  design does not depend on it.
- Making workers hold the CI lease for the whole run.
- Changing what the doctor does once it is launched.
- Coordinating two doctors, or a doctor with a review lane.

## Anti-goals

- A doctor pane that launches only to decide to stand down.
- A worker that never hears about the problem because the board skipped
  silently.
- A dead or crashed run blocking doctors, even for one pipeline.
- Interrupting a worker mid-turn (keystrokes or Escape into its pane). The
  ring is an inbox frame only, like the gate doorbell's no-Escape path.

## Behavior

### 1. Who counts as the branch owner

A work run owns a branch when all hold:

- its repo matches the MR's repo and its branch equals that branch;
- the run is not terminal (not ended, closed or failed);
- the run's own recorded Claude session resolves to a live inbox.

The herdr agent status (working, idle, blocked, done, unknown) does not
decide ownership. A worker that just finished a turn reads `done` and is
still present; a run waiting on Matt at a gate reads `blocked` and will
return to the branch. *(My call: the run's state and its own session decide,
not the agent status.)*

Only the run's recorded session counts. The liveness probe's fallback match
("any agent whose cwd is inside the worktree") is not enough, because the
board must know exactly which session it is ringing. The run summary gains
`session` (the run's `claude-session` field) and `mr` (its `mr` field),
denormalized the way `branch` already is, so ownership needs no herdr probe
at all. A run owns an MR when its `mr` equals the MR's url, or, before ship
has written `mr`, when its repo and `branch` match. *(My call.)*

If the run lookup itself fails (daemon or herdr unreachable), no run counts
and the doctor launches as today. *(My call: failing open keeps an outage
from silencing CI repair.)*

### 2. Auto path (triage)

Triage has two edge kinds, `pipeline-red` and `needs-rebase`
(`apps/board/src/triage/edge.ts`). Both launch a doctor today and both push,
so both defer. In the triage pass, after the existing lease and upstream
checks and before `attendants.claim`:

1. Look up an owner for the MR's source branch (section 1). The board reads
   runs through rt-client `listRuns` (`runs:list`).
2. No owner: continue to the stack check (section 3), then launch the doctor
   exactly as today.
3. Owner found: ring its session with the frame for the edge kind
   (section 5).
   - Delivered: no doctor, no lease claim. Record a handoff (run id, edge
     kind, pipeline id or rebase marker) on the MR's triage memory. Audit a
     `skip` with reason `run-active`, naming the run id and stage. Mark the
     edge handled.
   - Not delivered (session gone, socket dead): the run is not really live.
     Launch the doctor as today, and audit the failed ring.

Re-ring rules ride on triage's existing per-edge bookkeeping: once per
failing pipeline for `pipeline-red`, once per `needs-rebase` latch for a
rebase. A new failing pipeline rings again.

**A handoff whose run goes away.** Each pass re-checks every open handoff.
If its run no longer owns the branch (terminal, or its session no longer
resolves) and the edge still holds (same pipeline still red, or still needs
a rebase), the board clears the handoff, re-arms the edge (clears
`lastHandledPipelineId` or the rebase latch) and lets the normal path launch
a doctor on that pass. A handoff whose edge has cleared (green, rebased) is
simply dropped. *(My call: this is what keeps a crashed worker from leaving
a red pipeline with nobody on it.)*

### 3. Stacks: a live run on a parent branch

`upstreamBlocker` already treats a stack as one unit: an attended ancestor
may push and restack the child, so the child is skipped. A live run on an
ancestor branch joins that rule:

- When an MR goes red (or needs a rebase) and a live run owns one of its
  ancestor branches, the board launches no doctor on the child. Audit a
  `skip` with reason `upstream-run-active`, naming the ancestor MR and run.
- It also rings the ancestor's worker with a downstream frame (section 5),
  so the worker knows its branch's child is red. Same once-per-pipeline
  rule, keyed on the child's edge.
- The handoff and re-arm rules in section 2 apply, keyed on the child MR
  and the ancestor's run.

An owner on the MR's own branch wins over an ancestor owner: ring the MR's
own worker, not the parent's.

### 4. Manual path (a click on the board)

When Matt clicks to launch a doctor (`apps/board/src/server.ts`, the
manual doctor route, including the rebase-only mode) and an owner exists on
the MR's branch or an ancestor's, the board shows a prompt naming it, e.g.
"Pip's run is active on this branch (stage implement)", with two choices:

- **Ring worker**: same ring as the auto path for that edge kind; no doctor.
- **Launch anyway**: today's manual launch. Matt's click always wins.

### 5. The ring

A new daemon verb delivers a framed message into one Claude session's inbox
and reports whether it got through. The board server cannot reach session
sockets itself, so it calls the verb through rt-client.

Three frames, each labelled as coming from the board and carrying what the
worker needs to act without looking anything up:

```
[board] CI failed on !4127 (pipeline 9100001, job lint).
You're the active work run on this branch, so no doctor was launched.
Fold the fix into your current stage.
```

```
[board] !4127 needs a rebase onto main.
You're the active work run on this branch, so no doctor was launched.
Rebase before your current stage ends.
```

```
[board] !4128 (stacked on your branch) has failing CI (pipeline 9100002, job test).
No doctor was launched while your run is active. Check whether your change caused it.
```

*(My call: exact wording, the label, and the verb's name and payload shape
are the builder's.)*

### 6. The worker's side

The shared pipeline skill text (`plugins/mattstack/attachments/pipeline/`)
gains rules for the three `[board]` frames:

- CI failure on its own MR: part of the current stage's work. Fix it before
  the stage ends; do not start a separate fix loop or hand it off.
- Rebase on its own MR: rebase before the current stage ends.
- A stacked child is red: check whether its own change caused it; if so, fix
  it on its own branch; if not, say so in its run and carry on.

If the worker is already in watch-ci, a frame about its own MR changes
nothing (watch-ci owns CI there, and the lease already kept the doctor
away).

### 7. What Matt sees on the board

The MR row's doctor lane shows the handoff in place of a doctor status, e.g.
"CI failing, handed to the worker (run …, stage implement)" or "Child of an
active run, handed to the parent's worker". It clears when the edge clears,
a doctor launches, or the re-arm in section 2 fires.

## Constraints

- Every per-repo comparison keys on repo identity, never a derived name
  (`docs/repo-identity.md`).
- The ring never injects keystrokes or Escape into a pane.
- The new daemon handler gets its logging from `handleCommand`; it logs no
  outcome of its own (`.claude/rules/daemon.md`).
- No change to the CI lease, its owners or its TTLs.
- `RunAgent` is an rt-client type: rebuild `packages/rt-client` after
  changing it (`.claude/rules/workspace-packages.md`).

## Left to the builder

- The daemon verb's name, payload and result shape, and its rt-client
  wrapper.
- The frames' exact wording and label.
- Where the handoff record lives in triage memory and its exact shape.
- How the row line is drawn and worded (follows `rt:ui-copy`).
- Where in `triage/run.ts` the owner lookup sits relative to the existing
  checks, as long as an attended lease still wins first.
- Whether the run lookup is cached per triage pass.
