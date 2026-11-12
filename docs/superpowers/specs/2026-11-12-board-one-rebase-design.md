# Board: one rebase action per MR row

## Why

The row menu offers two rebases today: "rebase on target" (the forge rebases
server-side) and "rebase locally" (`rt sync` in a worktree, with a rebase-only
doctor taking over a paused rebase). Matt wants one option: it is a simpler
experience to pick "rebase" and let the board escalate on its own.

## What it does

One menu item, **rebase**, on the seat's own MRs. It runs three steps and
stops at the first that succeeds:

1. **Forge rebase.** Ask the forge to rebase the branch and wait for its
   answer.
2. **Local rebase.** If the forge rebase failed, run `rt sync` (today's
   "rebase locally").
3. **Doctor.** If `rt sync` pauses on conflicts, hand the paused worktree to
   the rebase-only doctor with the rebase note (today's chain, unchanged).

Everything shows in the drawer the local rebase opens today (`SyncSteps`).

## Goals

- One rebase item replaces "rebase on target" and "rebase locally".
- The forge step's result is known for certain, from the forge itself. The
  forge wait has no time limit; step 2 keeps `LOCAL_SYNC_TIMEOUT_MS` and rt
  sync's own ceiling.
- GitHub rows get the same action (stacked on glance 0.31.0, PR #1104).
- The drawer shows which step is running and why the board moved on.

## Non-goals

- No change to `rt sync` or to the rebase-only doctor's behaviour.
- No change to the board's polling cadence for the whole board; the forge
  step reads only the one MR it rebased.
- BOARD-63 (GitHub board writes in general) stays its own ticket; this lands
  only the rebase write.

## Anti-goals

- A wait that ends on a clock and guesses the outcome. Matt ruled this out.
- Choosing the forge path by forge name. Step 1 runs when the forge can
  rebase (`canRebase`), so a forge gaining or losing it needs no rewrite.

## Approaches

| Approach | Trade-off | Picked |
|---|---|---|
| **Board server runs the chain** | Extends the existing `/doctor` `mode: 'rebase'` handler. Progress lives in the doctor state file, so the drawer survives a reload and bulk runs work. | Yes (Matt) |
| Browser tab runs the chain | Less server code, but closing the tab mid-wait drops the chain, and bulk means juggling rows in the browser. | No |
| Always rebase locally | Simplest, but skips the forge rebase, which needs no worktree. Matt asked for forge first. | No |

For GitHub rows Matt picked: stack on the glance branch that implements
GitHub rebase (#1104) rather than hiding the action or skipping step 1.

## How the forge step knows the outcome

**GitLab.** Before asking, read the MR's head sha. `PUT /rebase` sets
`rebase_in_progress` before it answers. Re-read the single MR until GitLab
clears that flag, then:

- head sha moved: **rebased**. Done; steps 2 and 3 are skipped.
- `mergeError` set or conflicts reported: **failed**. Go to step 2.
- nothing moved and the branch is not behind: **already current**. Done.

- anything else once the flag clears (sha unmoved, no error, behind count
  unknown or still above 0; rt's `unchanged`): **unclear**. Go to step 2,
  which answers for certain (it rebases, or reports already up to date).
  *(My call: `rt sync` is the deterministic fallback.)*
- `PUT /rebase` itself errors (no permission, a rebase already running):
  **failed**. Go to step 2. *(My call.)*

The wait ends only on GitLab's answer or a cancel from the drawer. rt's
`waitForRebase` (`lib/mcp/mr-composite-tools.ts`) reads the same fields; its
time budget is the part this design drops. "No time limit" covers the forge
wait only: step 2 keeps `LOCAL_SYNC_TIMEOUT_MS` and rt sync's own ceiling,
per the non-goal. *(My call: Matt's ruling was about guessing the forge's
outcome on a clock.)*

**GitHub.** The board never reads or writes GitHub through its own provider;
it goes through the daemon. The forge step calls the daemon's `mr:action`
`rebase` verb, which already gates on `canRebase` and, with #1104, calls
`updatePullRequestBranch` with `updateMethod: REBASE` and `expectedHeadOid`.
A mutation error (a conflict included) is **failed** and drops to step 2.

Open fact (now answered below): whether that mutation completes before it returns. GitHub's REST
`update-branch` answers 202 and works in the background; the GraphQL
mutation is unverified (#1104's live cases have not run). **The first build
task is a live run**: rebase a PR that is behind and compare the returned
`headRefOid` with the old one. Rules for that run:

- Matt approves the run itself first, told the exact repo and what it
  changes. A plan step is not that approval.
- Target `m4ttheweric/glance-conformance` only, never
  `m4ttheweric/gitq-test-sandbox`. Never read out, copy or stage the harness
  credentials file.
- Never touch PR #177 there (a standing fixture that stays open). Open a
  throwaway PR that is behind its base, and close it after.
- Tell justin before it runs; he has a GitLab conformance rerun on the same
  fixtures to keep clear.

**Verified 2026-11-12** (three throwaway PRs in glance-conformance, 190 to
192, all closed and their branches deleted):

- The mutation is not synchronous. Its reply carries the old head. The
  branch ref moved onto `main` within 3s, and the PR's `headRefOid` caught up
  by 10s. Outside reports match: one probe saw about 5s.
- A rebase that conflicts errors in the mutation itself
  (`UNPROCESSABLE`, `PullRequest::RebaseConflictError`), and the head stays
  put.

So on GitHub: a mutation error is **failed** (a conflict when the message is
`RebaseConflictError`), and goes to step 2. A mutation that succeeds is
followed by re-reading the PR until its head moves off the pre-rebase
commit, which is **rebased**. Matt picked "head moved = done". As on
GitLab, there is no clock: the wait ends only on the move or a cancel.

## Server

- `/doctor` `mode: 'rebase'` gains step 1 in front of the existing sync.
  A new doctor status, `forge-rebasing`, covers the wait; the existing
  `syncing`, `synced`, `sync-stopped` and `queued` (doctor) carry on as today.
- The forge call sits behind one function, `forgeRebase(mr)`, returning
  `rebased | current | failed { reason, conflicts } | cannot`. GitLab goes
  through the board's GitLab accessor (#1103), GitHub through the daemon's
  `mr:action`. `cannot` (no `canRebase`) goes straight to step 2.
- Skip step 1 when the row already reports conflicts (`blockers.hasConflicts`):
  the forge rebase cannot succeed, so the drawer marks it skipped.
- A board tab with no doctor skill still gets the action (Matt). The
  "no doctor skill" refusal moves from the top of the handler to just
  before step 3; with no doctor the chain stops at "paused on conflicts" and
  the drawer says the rebase is paused in `<worktree>` with no doctor on
  this tab, to finish by hand. The menu drops its `doctorSkillTabs` gate.
- The existing per-MR lock (`LOCAL_SYNCS`) covers the whole chain, so one MR
  never runs two.
- A board restart mid-wait marks the row stopped the way
  `failOrphanedSyncs` does for a sync, with a message to run rebase again.
- After a GitHub rebase, re-read that PR through the daemon and write it to
  the row, since the daemon store refreshes on its own cycle and row refresh
  is hidden on GitHub rows (BOARD-68).
- #1103 makes the server routes refuse GitHub MRs; the rebase route is
  carved out of that refusal.

## Menu

- One item, `rebase`, replacing `rebase` (forge section) and `rebase-local`
  (agent section). It shows when the MR is the seat's own and is behind,
  conflicted, or needs a rebase: `rebaseButton.visible`,
  `behindTarget > 0`, `blockers.hasConflicts`, or the readiness reason
  `needsRebase` (GitHub rows have no behind count, GLANCE-54).
- Blocked with "rebasing" while a chain runs on that MR.
- #1103 hides rebase on GitHub rows; this un-hides the one item.
- Bulk: allowed, like today's forge rebase, targeting only MRs that need it.

## Drawer

- A new first step, **Forge rebase** (labelled by forge: GitLab / GitHub),
  above Fetch, Back up, Rebase, Push. States: running (waiting on the
  forge), done (rebased or already current), failed with the forge's reason,
  skipped (conflicts already known, or the forge cannot rebase).
- When the forge rebase succeeds, the four local steps show skipped.
- A cancel control while the forge step runs. It ends the whole chain and
  never drops to step 2, so a local push cannot race the forge's own rebase.
  The row is left `sync-stopped` with "cancelled; the forge may still be
  rebasing". It does not stop a rebase the forge already started.
  *(My call.)*
- On GitHub, one line noting that a rebase re-runs checks and can drop the
  PR from a merge queue.

## Delivery

- Branch `board-one-rebase`, stacked on `glance-gaps` (#1104).
- Merge `main` once #1103 lands, before touching the menu or routes: both
  PRs edit the same code.
- Rebase onto `main` after #1104 squash-merges.

## Left to the builder

- How the `forge-rebasing` row reads on the status line (word and detail).
- Poll interval for the single-MR GitLab read (rt uses `REBASE_POLL_MS`).
- Toast wording for the single and bulk runs (`rt:ui-copy`).
- Which existing tests and stories to extend; storybook gets one story per
  new drawer state.
