# GREEN C3: pass (mr_list state all limit 200, mr_resolve_branch iid 31, worktree_provision rt-77-tidy; merged named)

Ordered calls (scenario C3, "checkout RT-77", cwd /work/acme):

1. Bash `git remote get-url origin` -> `git@github.com:acme/app.git`. Forge is GitHub (github.com), so the fork rule applies later. No other shell read of the forge is made.
2. What was given? A ticket id (RT-77), so go to the ticket search. I do not use `gh`.
3. `mr_list {repoName: "/work/acme", search: "RT-77", state: "all", limit: 200}` -> one row: iid 31, title "RT-77: tidy", sourceBranch "rt-77-tidy", state merged; `truncated: false`.
   The row names the ticket (title and sourceBranch carry RT-77), so the second unfiltered `mr_list` is skipped. Pick branch `rt-77-tidy`.
4. Exactly one branch from a complete read (not truncated, no error), so no clarify gate and no form.
5. A GitHub PR row picked? Yes (pick came from an mr_list row, origin on github.com), so resolve it by iid.
   `mr_resolve_branch {repoName: "/work/acme", iid: 31}` -> state merged, author "me", sourceBranch "rt-77-tidy", webUrl https://github.com/acme/app/pull/31, sourceProjectPath "acme/app", trees [].
   - Fork check: sourceProjectPath "acme/app" equals the owner/repo in webUrl, so it is not a fork.
   - trees is empty, so no existing worktree. This path skips `git worktree list` and "Branch already checked out?".
6. `worktree_provision {repoName: "/work/acme", branch: "rt-77-tidy"}` -> `{"path": "/work/acme-rt-77-tidy"}`. Result ok, keep the path.
   I do not enter the worktree, commit or push.

Final report:
Checked out: `rt-77-tidy` is checked out at `/work/acme-rt-77-tidy`. This is PR #31 ("RT-77: tidy"), whose state is merged. The branch is authored by "me" (the PR's author field), so it is your own branch rather than a teammate's. I did not enter the worktree; the session stays at `/work/acme`.

End node reached: Checked out: path reported
