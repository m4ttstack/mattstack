# A merge the daemon never saw open still asks the session to leave

Ticket: RT-580. Builds on RT-576 (`2026-11-14-merge-asks-session-to-leave-design.md`).

## Why

RT-576 asks a session to leave its tree when its PR merges, but only when the
reactor saw the PR `opened` first. When it didn't (the daemon was down while
the PR opened, or the PR opened and merged between two MR cache refreshes),
the merge takes the unwitnessed path: a tree with a live cwd inside is held
with `heldReason`, nobody is asked, and nothing happens until the session
leaves by itself.

The unwitnessed path holds because nothing proves the merged MR belongs to
this tree: the cache is branch-keyed, so a reused branch name can surface an
older lifecycle's merged MR.

## Goals

- An unwitnessed merge whose MR provably came from this tree asks the session
  to leave exactly as a witnessed one does: leaving mark, the mod's question,
  the 3-minute grace, then the kill.
- A tree on a reused branch name is never asked to leave and never disposed
  for an MR it did not produce.

## Non-goals

- Changing the witnessed path, job trees, or main-tree auto-return (which
  stays edge-only).
- Adding merge time or base sha to the MR cache.

## Approaches

1. **Commit proof (Matt's pick).** Ask only when the tree's own commits are
   the merged MR's commits. Uses data the reactor already holds (`mr.sha`,
   the MR's source head) and git.
2. Time proof: ask only when the tree was claimed before the MR merged. Needs
   `mergedAt` in the cache for GitHub and GitLab, and a reuse claimed before
   the old merge still slips through.
3. Both: option 2's plumbing for a case option 1 already covers.

## The design

### The proof (my call on the exact rule)

A tree on the unwitnessed path is **proven** when its `HEAD` is the merged
MR's source head (`mr.sha`), and its branch ref, if it differs from `HEAD`,
is an ancestor of `mr.sha` (the same tips `mergedMrCoversTips` checks).

Why exact `HEAD` match rather than "every tip is an ancestor of `mr.sha`":
a fresh or stale tree whose `HEAD` is an older main commit (an on-deck tree
hydrated before the MR branched) passes the ancestor check with no commits
of its own. An MR always has commits, so its source head is never a bare
main commit, and a tree sitting on it is the tree that pushed it.

Known limit: the `HEAD` match also fits a later tree that checked out the
merged head (the remote branch kept after merge, or a fast-forward). That
costs at most an unwanted leave question; no work is lost, since the dirty
guard and the trash still apply.

A tree whose `HEAD` is behind `mr.sha` (someone else pushed to the branch and
the session never pulled) is not proven and keeps today's quiet hold. No
regression, only a missed ask.

### The reactor change (`lib/daemon/reconciler/reactor.ts`, `detectTransitions`)

On the unwitnessed path, for each ephemeral claimed/disposable tree on the
branch:

- **Proven:** treated as witnessed for that tree. It skips the live-cwd gate
  (and needs no lsof snapshot) and goes to `actOnTree`, which calls
  `disposeTree(..., { auto: true, askSessions: { why } })`. The leaving
  mark, `drainLeavingTrees`, the grace and the fired key then behave as on
  the witnessed path.
- **Not proven:** unchanged: the live-cwd gate, `holdForLiveProcess`, and the
  fired key left unspent while a live tree defers.

A failed git read during the proof counts as not proven (fail closed).

## Acceptance

- A PR opened and merged inside one cache refresh, with a session in its
  tree at the MR's head, shows the leave question.
- A daemon restart between open and merge still ends with the question
  (same path: the reactor's state has no `opened` for the branch).
- A tree on a reused branch name (its `HEAD` is not the merged MR's head) is
  neither asked nor disposed; with a live cwd inside it is held as today.
- A tree whose `HEAD` is behind `mr.sha` is held as today.

## Constraints

- Targeted tests only locally (`lib/daemon/reconciler/__tests__/`).
- Live check per `reference_live_testing_merge_reactor`: reproduce by
  opening and merging inside one cache refresh, or restarting the daemon
  between open and merge.

## Left to the builder

- Where the proof helper lives (beside `mergedMrCoversTips` in
  `lib/worktree/containment.ts` is the natural place).
- Log line wording for a proven unwitnessed ask.
