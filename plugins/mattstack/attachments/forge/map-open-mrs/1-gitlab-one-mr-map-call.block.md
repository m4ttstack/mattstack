---
order: 1
---

# 1. GitLab: one `mr_map` call

The `mr_map` tool with `repoName` = the current checkout's absolute path
and `author` `me` returns the signed-in user's open MRs as `rows`, each
already joined to its worktree. Map each row to the table: `ref`,
`title`, `author`, `sourceBranch`, and `worktree` (a null `worktree` is a
`NONE` row). When the result says `complete: false`, say plainly that the
list was cut at 200 open MRs. Then go to step 4. A GitLab error is the
whole result, quoted, with no table.
