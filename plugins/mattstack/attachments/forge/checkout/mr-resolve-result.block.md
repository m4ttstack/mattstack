---
node: mr_resolve_result
label: MR resolve result
---

# mr_resolve_branch result?

`mr_resolve_branch` takes `repoName` = the current checkout's absolute
path, and `mrUrl` = the link or `iid` = the number. It reads the MR and the
registered worktrees in one call, so this path skips `git worktree list`
and `Branch already checked out?`; those stay for a branch name, a ticket
id and GitHub. `branch` for `worktree_provision` is `sourceBranch`.
`trees` holds the worktrees already on that branch: with several, report
every path, never pick one. `author` is whose branch it is. An MR whose
`state` is merged or closed takes the same checkout, and the report names
the state. A GitLab error goes to the clarify gate's sentence, quoted.
