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

## 2. Plan the sweep, then gate `sweep`

One sentence: how many branches rebase, how many are skipped up front (NONE
rows, nothing local to rebase) and why. Then the gate, once for the whole
batch, never per branch:

- When `RT_RUN_DB` is set: `rt runs field set gate sweep --stage sync-open-mrs`.
- The form: a multi-select of the branches to rebase, in order, all
  pre-selected (deselecting skips one); **Iterate here** (their text
  reorders or excludes); **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope sweep --selection '{"branches":[...]}' --decided-by sync-open-mrs`.

Nothing is touched before the answer.

## 3. Rebase each branch

In the order from step 2, follow `mattstack:rebase-worktree` per branch. A
conflict stops only that branch -- `rebase-worktree` hands it back
mid-rebase; record it in a needs-hands list and move on. A precondition
refusal (dirty tree, no upstream) stops it too -- record it as skipped with
the reason and move on; neither ever blocks the rest of the sweep.
`rebase-worktree` also asks per branch whether to push after a clean rebase
-- defer that; step 4 makes the push call once for the whole batch.

## 4. Gate `push`, then watch CI

Once the rebase pass finishes, one sentence: which branches rebased clean
(old head -> new head each). Then the gate, once for the batch; never push
a branch unasked, never one-by-one as each rebase completes:

- When `RT_RUN_DB` is set: `rt runs field set gate push --stage sync-open-mrs`.
- The form: a multi-select of the clean branches to `git push
  --force-with-lease`, all pre-selected; **Watch CI after pushing** (yes /
  no); **Iterate here**; **Hold**.
- When `RT_RUN_DB` is set: `rt runs decision record --contract gate@1 --scope push --selection '{"branches":[...],"watch_ci":true|false}' --decided-by sync-open-mrs`.

Push the selected branches, then, when asked, follow `mattstack:watch-ci`
per pushed branch (it inherits this run and hands back its verdict).

## 5. Report

One table, every branch from step 1 landing in exactly one bucket:
rebased (old head -> new head), pushed, conflicted (needs-hands), or
skipped (with reason -- dirty tree, no upstream, NONE row).

## Wrap-up form contract

{{include:wrap-up-form}}
