---
name: map-open-mrs
disable-model-invocation: true
description: "Use when acting on all of the user's open MRs or PRs at once -- a batch sweep, rebase, or audit that needs each open item paired with the local worktree holding its branch. The discovery step of sync-open-mrs."
allowed-tools:
  - Bash(gh pr list:*)
  - Bash(glab mr list:*)
  - Bash(git worktree list:*)
  - Bash(rt worktree:*)
type: pipeline-step
slots: {}
---

# map-open-mrs

Pair every open MR/PR with the local worktree holding its source branch,
so a downstream sweep knows what it's touching before it acts. Discovery
only -- this skill never creates, rebases, or removes anything.

## 1. List the open items

Prefer `glab mr list --author=@me --per-page=100`; fall back to
`gh pr list --author @me` when `glab` isn't set up for this repo. Capture
each item's ref (`!iid` or `#number`), title, and source branch.

## 2. List local worktrees

`git worktree list` from the main checkout covers plain git trees. When
`rt` is available, `rt worktree list --json` gives a fuller inventory --
prefer it over parsing `git worktree list` by hand when both exist.

## 3. Join and emit

Pair each MR's source branch to a worktree's branch by exact string
equality only -- a prefix or substring match wrongly pairs `foo-1` with
`foo-10`. An MR with no matching worktree is not an error; it's a `NONE`
row, expected for MRs never checked out locally or already cleaned up.

Emit one table, one row per open MR, four columns:

| MR ref | title | source branch | worktree path or NONE |
|--------|-------|----------------|------------------------|

This shape is the contract a caller downstream (such as a sweep over all
open MRs) reads to decide what to act on -- report both paired and `NONE`
rows plainly and stop.
