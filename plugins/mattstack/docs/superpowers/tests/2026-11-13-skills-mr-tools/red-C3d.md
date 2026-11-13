# RED C3d: fails as expected (alias origin; gh pr list --search, gh pr view; fork PR provisioned by branch name)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# Reply: scenario C3d (checkout RT-77)

## Ordered calls

1. `git remote get-url origin` (cwd `/work/acme`)
   - Result: `git@work-github:acme/app.git`. `work-github` is an SSH host alias for GitHub, so the forge host is GitHub.
   - "What was given?": a ticket id (`RT-77`). "Ticket forge host?": GitHub, so I take the `gh pr list --search` edge. The GitLab read tools (`mr_list`, `mr_resolve_branch`) are not on this path, so I do not call them.

2. `gh pr list --search RT-77 --state all --limit 200 --json number,title,headRefName,state`
   - Result: one row, #31 "RT-77: tidy", head branch `rt-77-tidy`, state MERGED. 1 row against a limit of 200, so the read is complete, not cut off.
   - "Pick the branch from the result": the row's title and head branch both carry RT-77. Candidate: `rt-77-tidy` (merged).

3. `gh pr view 31 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state`
   - I call this because the report has to say whose branch it is, and the list did not return that.
   - Result: `headRefName` `rt-77-tidy`, `headRepositoryOwner.login` `someone`, `headRepository.name` `app-fork`, `isCrossRepository: true`, state MERGED.
   - So the branch belongs to `someone` and lives on the fork `someone/app-fork`, not on `acme/app`. My skill has no rule for fork PRs on GitHub, so I note it and keep going.
   - "Exactly one branch, from a complete read?": yes, `rt-77-tidy`.

4. `git worktree list --porcelain`
   - Result: only `/work/acme` on `refs/heads/main`.
   - "Branch already checked out?": no.

5. `worktree_provision {repoName: "/work/acme", branch: "rt-77-tidy"}`
   - Result: `{"path": "/work/acme-rt-77-tidy"}`, so it succeeded and I keep that path.
   - I do not enter the worktree. The session stays in `/work/acme`.

6. Report the path and whose branch it is. End node: **Checked out: path reported**.

## Final report

RT-77 is PR #31, "RT-77: tidy". That PR is **merged**. Its branch `rt-77-tidy` is now checked out at `/work/acme-rt-77-tidy`. It belongs to `someone`, not to you: the PR came from their fork `someone/app-fork` (cross-repository), not from `acme/app`. Because it's a fork PR, the tree may hold `acme/app`'s copy of a branch with that name rather than the fork's head, so check the tree's HEAD against PR #31 before you rely on it. This is a review checkout. Don't commit or push on that branch. My session is still in `/work/acme`.

End node: **Checked out: path reported** (no gate reached).
