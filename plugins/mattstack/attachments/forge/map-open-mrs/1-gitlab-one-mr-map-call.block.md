---
order: 1
label: Map call
---

# 1. One `mr_map` call

The `mr_map` tool with `repoName` = the current checkout's absolute path
and `author` `me` returns the signed-in user's open MRs or PRs as `rows`,
each already joined to its worktree. Map each row to the table: `ref`,
`title`, `author`, `sourceBranch`, and `worktree` (a null `worktree` is a
`NONE` row). When the result says `complete: false`, say plainly that the
list was cut at 200 open MRs on GitLab or 200 open PRs on GitHub, told
apart by the rows' `ref` marker (`!` or `#`). A forge error is the whole
result, quoted, with no table. Then go to step 2.
