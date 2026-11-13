# RED C7: GitLab walk recorded (git remote get-url, mr_resolve_branch, worktree_provision)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# Run: checkout, scenario C7

(No `skills_resolve` call: this path never reaches an `@key` pointer. The only one is in the structured-context gate section, and no gate opens here.)

## Ordered calls

1. `git remote get-url origin` (Bash, from /work/acme)
   - Result: `git@gitlab.com:acme/app.git`. The forge host is GitLab.
   - What was given? An MR link, so I go to "MR forge host?", which is GitLab, so I go to `mr_resolve_branch`. I do not use the GitLab CLI.

2. `mr_resolve_branch {repoName: "/work/acme", mrUrl: "https://gitlab.com/acme/app/-/merge_requests/9"}`
   - Result: iid 9, state `opened`, author `dana`, sourceBranch `fix-y`, trees `[]`.
   - mr_resolve_branch result? No tree, so I go straight to `worktree_provision` with `branch` = `fix-y`. This path skips `git worktree list` and "Branch already checked out?", because mr_resolve_branch already read the registered worktrees.

3. `worktree_provision {repoName: "/work/acme", branch: "fix-y"}`
   - Result: `{"path": "/work/acme-fix-y"}`.
   - worktree_provision result? ok, so I keep the path and go to "Report the path and whose branch it is". I do not enter the worktree. The session stays in /work/acme.

## Final report

Checked out dana's branch `fix-y` (MR !9, opened, https://gitlab.com/acme/app/-/merge_requests/9) at `/work/acme-fix-y`. This is dana's branch: it is a review checkout, so I will not commit or push on it. I have stayed in /work/acme and have not moved into the worktree.

## End node

Checked out: path reported
