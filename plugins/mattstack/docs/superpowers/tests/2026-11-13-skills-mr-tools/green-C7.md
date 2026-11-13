# GREEN C7: pass (GitLab: mr_resolve_branch, worktree_provision fix-y; never the fork terminal)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# green-C7

No `@key` pointer sits on the path this scenario walks, so I make no `skills_resolve` call.

## Ordered calls

1. `git remote get-url origin` (Bash, cwd `/work/acme`)
   - Result: `git@gitlab.com:acme/app.git`. The forge host is GitLab, so the fork rule does not apply.
   - What was given? An MR link, so the next node is `mr_resolve_branch`. I do not read the MR with the GitLab CLI.

2. `mr_resolve_branch {repoName: "/work/acme", mrUrl: "https://gitlab.com/acme/app/-/merge_requests/9"}`
   - Result: `{"iid": 9, "state": "opened", "author": "dana", "sourceBranch": "fix-y", "webUrl": "...", "trees": []}`.
   - mr_resolve_branch result? This is a GitLab result, so it is never a fork PR. No forge error. `trees` is empty, so the edge is "no tree" and the next node is `worktree_provision`. This path skips `git worktree list` and "Branch already checked out?". The branch is `sourceBranch` = `fix-y`. The author is `dana`. The state is `opened`.

3. `worktree_provision {repoName: "/work/acme", branch: "fix-y"}`
   - Result: `{"path": "/work/acme-fix-y"}`.
   - worktree_provision result? ok: I keep its path. I do not enter the worktree, and I stay in `/work/acme`.

Then I report the path and whose branch it is.

## Final report

Checked out dana's branch `fix-y` (MR !9, opened) at `/work/acme-fix-y`. It is a review checkout of a teammate's branch, so I will not commit or push on it. This session stays in `/work/acme`.

End node: **Checked out: path reported**
