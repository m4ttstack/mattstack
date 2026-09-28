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

## 1. List the open items

GitLab: the `mr_list` tool with `repoName` = the current checkout's
absolute path and `state` `opened`. It reads the daemon's open-MR cache,
which may be limited to certain authors and a recent time window: the
list is what the cache holds, not a promise of every open MR. The tool
has no author filter. When the conversation already names the user's
forge username, keep only the rows whose author is that username and say
so; otherwise keep every row. Never guess a username.

GitHub: `gh pr list --author @me`.

Capture each item's ref (`!iid` or `#number`), title, author, and source
branch.

## 2. List local worktrees

The `rt_verb` tool with `args` `["worktree", "list"]` gives the fuller
inventory; prefer it over parsing `git worktree list` by hand. It lists
every repo rt knows: keep only the `trees` rows whose `repoName` matches
the row whose `path` is the current checkout. `git worktree list` from
the main checkout covers plain git trees when `rt_verb` errors.

## 3. Join and emit

Pair each MR's source branch to a worktree's branch by exact string
equality only -- a prefix or substring match wrongly pairs `foo-1` with
`foo-10`. An MR with no matching worktree is not an error; it's a `NONE`
row, expected for MRs never checked out locally or already cleaned up.

Emit one table, one row per open MR kept in step 1, five columns:

| MR ref | title | author | source branch | worktree path or NONE |
|--------|-------|--------|----------------|------------------------|

This shape is the contract a caller downstream (such as a sweep over all
open MRs) reads to decide what to act on: the `author` column is how it
tells the user's MRs from anyone else's when step 1 kept every row.
Report both paired and `NONE` rows plainly and stop.
