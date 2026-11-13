# GREEN C1: pass (mr_resolve_branch by URL, same repo, worktree_provision fix-x; no gh)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

# green-C1 reply

Ordered calls:

1. Bash `git remote get-url origin` -> `git@github.com:acme/app.git`. The origin decides the forge host: github.com (an SSH alias would still give a github.com webUrl).
2. What was given? A PR link, so `mr_resolve_branch`. I do not use `gh pr view` or any GitHub CLI for the MR or PR read (STOP node).
3. `mr_resolve_branch {repoName: "/work/acme", mrUrl: "https://github.com/acme/app/pull/12"}` -> iid 12, state opened, author dana, sourceBranch fix-x, webUrl on github.com, sourceProjectPath "acme/app", trees [].

Reading the result:
- Fork check applies because webUrl is on github.com. The `<owner>/<repo>` in webUrl is `acme/app` and `sourceProjectPath` is `acme/app`. They are equal, so this is not a fork PR and the branch is origin's.
- `trees` is empty, so there is no tree on the branch. This path skips `git worktree list` and "Branch already checked out?".
- `branch` for provisioning = `sourceBranch` = `fix-x`.

4. `worktree_provision {repoName: "/work/acme", branch: "fix-x"}` -> `{"path": "/work/acme-fix-x"}`. This is ok, so I keep the path.
5. Report path and owner. I do not enter the worktree and I make no commit or push. No gate opened and no skills_resolve call was needed, because no `@key` pointer was used on this path.

End node: **Checked out: path reported**.

Final report:
Checked out PR #12 (state: opened) at `/work/acme-fix-x`, with branch `fix-x` checked out there. The branch belongs to dana, not to you. I did not enter the worktree and I made no commits or pushes on it.
