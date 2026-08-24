---
name: sync-open-mrs
disable-model-invocation: true
description: "Use when every open MR or PR should be brought current with the default branch in one sweep -- 'rebase all my open MRs', 'my branches are stale, sync them', batch maintenance after the default branch moved."
allowed-tools:
  - Bash(gh pr list:*)
  - Bash(glab mr list:*)
  - Bash(git worktree list:*)
type: pipeline-step
slots: {}
---

# sync-open-mrs

Batch maintenance for "all my open MRs are stale": discover every open
item, rebase each onto the default branch, and offer to push and watch CI,
all in one sweep. This skill is a delegator -- it owns sequencing, the user
gates, and the final report; discovery, rebasing, and CI watching belong to
a focused skill it calls, not reimplemented here.

## 1. Discover

Follow `mattstack:map-open-mrs` and get its table: MR ref, title, source
branch, worktree path or NONE.

## 2. Plan the sweep, get one go

Present the plan: which branches will be rebased, in what order, and
which rows are skipped up front -- NONE rows, nothing local to rebase --
with the reason for each. Get exactly one go-ahead from the user for the
whole batch before touching any branch. Not a per-branch confirmation.

## 3. Rebase each branch

In the order from step 2, follow `mattstack:rebase-worktree` per branch. A
conflict stops only that branch -- `rebase-worktree` hands it back
mid-rebase; record it in a needs-hands list and move on. A precondition
refusal (dirty tree, no upstream) stops it too -- record it as skipped with
the reason and move on; neither ever blocks the rest of the sweep.
`rebase-worktree` also asks per branch whether to push after a clean rebase
-- defer that; step 4 makes the push call once for the whole batch.

## 4. Offer pushes, then watch CI

Once the rebase pass finishes, list every branch that rebased clean and
offer `git push --force-with-lease` for all of them as one batch
decision -- never push a branch unasked, and never push one-by-one as
each rebase completes. On yes, push each, then, only if the user wants
CI watched, follow `mattstack:watch-ci` per pushed branch.

## 5. Report

One table, every branch from step 1 landing in exactly one bucket:
rebased (old head -> new head), pushed, conflicted (needs-hands), or
skipped (with reason -- dirty tree, no upstream, NONE row).
