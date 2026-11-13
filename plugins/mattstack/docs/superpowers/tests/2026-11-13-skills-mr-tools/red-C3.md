# RED C3: fails as expected (gh pr list --search)

Ordered calls (checkout skill, scenario C3: "checkout RT-77", GitHub origin)

1. `git remote get-url origin` -> `git@github.com:acme/app.git`. The origin URL decides the forge host: GitHub. What was given is a ticket id, so the ticket forge host branch is GitHub. The mr_list and mr_resolve_branch tools are GitLab-only, so I do not call them.
2. `gh pr list --search RT-77 --state all --limit 200 --json number,title,headRefName,state` -> one row: #31, "RT-77: tidy", head branch `rt-77-tidy`, MERGED. The row's title carries the ticket id, so I pick `rt-77-tidy`. It is exactly one branch from a complete read (1 row, far under the 200 limit), so there is no clarify gate and no fallback unfiltered read.
3. `git worktree list` (the scenario supplies `--porcelain` output) -> only `/work/acme` on `main`. `rt-77-tidy` is not checked out anywhere, so I go on to provision.
4. `worktree_provision {repoName: "/work/acme", branch: "rt-77-tidy"}` -> `{"path": "/work/acme-rt-77-tidy"}`. The result is ok, so I keep the path. I do not enter the worktree.

No gates open, no gh pr view, and no skills_resolve call (no @key pointer is needed on this path).

Final report:
Checked out: `rt-77-tidy` is now checked out at `/work/acme-rt-77-tidy`. It is the branch of PR #31 "RT-77: tidy" (acme/app), whose state is merged. It is a teammate's branch, not mine. The GitHub reads I ran did not return the PR author, so I cannot name the author. I did not enter the worktree, and I will not commit or push on this branch.

End node reached: Checked out: path reported.
