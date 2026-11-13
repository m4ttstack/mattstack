# RED C1: fails as expected (gh pr view, git worktree list)

# red-C1 reply

## Ordered calls

1. `git remote get-url origin` -> `git@github.com:acme/app.git`. Host is GitHub, so the forge is GitHub.
2. What was given: a PR link, so go to "MR forge host?". GitHub, so use `gh pr view`. I do not call `mr_resolve_branch` (that is the GitLab path), and I do not use the GitLab CLI.
3. `gh pr view 12 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` -> headRefName `fix-x`, owner `acme`, repo `app`, isCrossRepository false, state OPEN.
4. Pick the branch: exactly one branch, `fix-x`, from a complete read (not a fork). One-branch check passes, so no clarify gate.
5. `git worktree list` (porcelain form) -> only `/work/acme` on `main`. `fix-x` is not checked out anywhere, so go to provision.
6. `worktree_provision {repoName: "/work/acme", branch: "fix-x"}` -> `{"path": "/work/acme-fix-x"}`. Result ok, so keep the path. I do not enter the worktree, and I make no commit or push.
7. Report the path and whose branch it is (final report below).

## Final report

PR #12 of acme/app is open. Its head branch `fix-x` is now checked out at `/work/acme-fix-x`. The branch is the PR's own head in acme/app (same repo, not a fork), so it belongs to the PR author, not to me. The `gh` read I made did not return the author's name, so I do not name one. I did not enter the worktree, and I will not commit or push on it.

## End node

Checked out: path reported
