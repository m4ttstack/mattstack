---
name: map-open-mrs
disable-model-invocation: true
description: "Use when acting on all of the user's open MRs or PRs at once -- a batch sweep, rebase, or audit that needs each open item paired with the local worktree holding its branch. The discovery step of sync-open-mrs."
allowed-tools:
  - Bash(gh pr list:*)
  - Bash(git worktree list:*)
type: pipeline-step
slots: {}
---

# map-open-mrs

Pair each open MR/PR with the local worktree holding its source branch,
so a downstream sweep knows what it's touching before it acts. Discovery
only -- this skill never creates, rebases, or removes anything.

## 1. GitLab: one `mr_map` call

The `mr_map` tool with `repoName` = the current checkout's absolute path
and `author` `me` returns the signed-in user's open MRs as `rows`, each
already joined to its worktree. Map each row to the table: `ref`,
`title`, `author`, `sourceBranch`, and `worktree` (a null `worktree` is a
`NONE` row). When the result says `complete: false`, say plainly that the
list was cut at 200 open MRs. Then go to step 4. A GitLab error is the
whole result, quoted, with no table.

## 2. GitHub: list the open PRs

`gh pr list --author @me`. Capture each item's ref (`#number`), title,
author, and source branch.

## 3. GitHub: list local worktrees and join

The `rt_verb` tool with `args` `["worktree", "list"]` gives the fuller
inventory; prefer it over parsing `git worktree list` by hand. It lists
every repo rt knows: keep only the `trees` rows whose `repoName` matches
the row whose `path` is the current checkout. `git worktree list` from
the main checkout covers plain git trees when `rt_verb` errors.

Pair each PR's source branch to a worktree's branch by exact string
equality only -- a prefix or substring match wrongly pairs `foo-1` with
`foo-10`. A PR with no matching worktree is not an error; it's a `NONE`
row, expected for PRs never checked out locally or already cleaned up.

## 4. Emit

Emit one table, one row per open MR or PR, five columns:

| MR ref | title | author | source branch | worktree path or NONE |
|--------|-------|--------|----------------|------------------------|

This shape is the contract a caller downstream (such as a sweep over all
open MRs) reads to decide what to act on.
Report both paired and `NONE` rows plainly and stop.
