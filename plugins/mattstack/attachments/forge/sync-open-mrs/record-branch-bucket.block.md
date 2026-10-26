---
node: record_branch_bucket
---

# Record the branch in its bucket

The `branch_sync` result's `kind` decides the bucket. No branch's outcome
blocks the rest of the sweep:

| result | bucket |
|---|---|
| `synced`, `pushed: true` | pushed ("pushed by branch_sync") |
| `synced`, `pushed: false` | rebased, still unpushed (origin does not hold the new head) |
| `up-to-date` | current |
| `conflict` | needs-hands, files from `unresolvedFiles`; the rebase stays paused |
| `push-refused` | rebased, still unpushed (to the push gate) |
| `stacked-refused`, `stack-unverified` | skipped, `refusal` quoted |
| `error` whose refusal says "run git_pull first" | the pull pass (first time only); after the pull pass, skipped with the refusal |
| `dirty-tree` on a branch the form listed | the dirty gate (first time only); after the retry, skipped: dirty tree |
| any other `error` (a preflight refusal, a sweep tree refusal, an rt sync failure) | skipped, `refusal` quoted |
| a `git_pull` error | skipped, the error quoted |
| a sweep `noTree` row, a map NONE row | skipped: no worktree |
| a branch deselected at the sweep gate | skipped at the gate, reported, never synced |

A sweep `dirty-tree` result for a branch the map did not list is reported
and skipped: dirty tree, never gated.

A branch passes the pull pass and the dirty gate at most once each, so
neither loops. The pushed and rebased lines carry the move as sha +
subject: read `git -C <tree> log -1 --oneline --no-decorate <oldHead>` and
the same for `<newHead>`.
