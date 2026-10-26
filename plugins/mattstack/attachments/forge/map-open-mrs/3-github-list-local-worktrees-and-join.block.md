---
order: 3
label: GitHub join worktrees
---

# 3. GitHub: list local worktrees and join

The `rt_verb` tool with `args` `["worktree", "list", "--json"]` gives the fuller
inventory; prefer it over parsing `git worktree list` by hand. It lists
every repo rt knows: keep only the `trees` rows whose `repoName` matches
the row whose `path` is the current checkout. `git worktree list` from
the main checkout covers plain git trees when `rt_verb` errors.

Pair each PR's source branch to a worktree's branch by exact string
equality only -- a prefix or substring match wrongly pairs `foo-1` with
`foo-10`. A PR with no matching worktree is not an error; it's a `NONE`
row, expected for PRs never checked out locally or already cleaned up.
