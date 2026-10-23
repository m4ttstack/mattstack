---
node: report_path_owner
---

# Report the path and whose branch it is

Report the path (the `path` `worktree_provision` returned, the worktree
`git worktree list` already showed, every path in `mr_resolve_branch`'s
`trees`, or the one the recorded move made) and
that the branch is checked out there. State whose branch it is. Do not
enter the worktree, whatever the tool suggests: a review checkout leaves
the session where it is.
