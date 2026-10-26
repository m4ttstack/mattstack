---
node: mr_map_result
label: MR map result
---

# mr_map result?

**rows**: the call returned `{rows, complete}` with `repoName` = the
checkout's absolute path; each row is a map row (`ref`, `title`, `author`,
`sourceBranch`, and `worktree`, where null is a NONE row), and its `dirty`
and the result's `complete` feed the plan. **GitLab error**: there is no
map, so nothing is planned, rebased or pushed; the report's one line is
the error, quoted, and the sweep ends abandoned.
