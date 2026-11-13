---
node: mr_resolve_result
label: MR resolve result
---

# mr_resolve_branch result?

`mr_resolve_branch` takes `repoName` = the current checkout's absolute
path, and `mrUrl` = the link or `iid` = the number. It reads the MR or PR
and the registered worktrees in one call, so this path skips
`git worktree list` and `Branch already checked out?`; those stay for a
branch name and a GitLab ticket pick. `branch` for `worktree_provision` is
`sourceBranch`. `trees` holds the worktrees already on that branch: with
several, report every path, never pick one. `author` is whose branch it
is. An MR or PR whose `state` is merged or closed takes the same checkout,
and the report names the state. The forge's error goes to the clarify
gate's sentence, quoted.

The fork rule applies only to a GitHub result: one whose `webUrl` is on
github.com (a GitLab `webUrl` never is, and an SSH-alias origin still
gives a github.com `webUrl`). On GitHub, the PR's branch is this repo's
only when `sourceProjectPath` equals the `<owner>/<repo>` in its
`webUrl`. When `sourceProjectPath` differs, is null (a deleted fork) or
is absent (the token cannot read the head repo), the result is a fork PR:
never call `worktree_provision`, and end at **Fork PR: reported** with one
sentence: `#<n>`'s branch `<sourceBranch>` lives in a fork
(`<sourceProjectPath>`; "a deleted fork" when it is null; "a repository
this token cannot see" when it is absent), not on origin, so nothing was
checked out. A GitLab result has no `sourceProjectPath` and is never a
fork.
