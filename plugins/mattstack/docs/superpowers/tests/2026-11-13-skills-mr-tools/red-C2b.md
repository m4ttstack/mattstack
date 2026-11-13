# RED C2b: fails as expected (gh pr view; fork PR reported as acme's own main)

Ordered calls (scenario C2b, "checkout #40", cwd /work/acme)

1. `git remote get-url origin` -> `git@github.com:acme/app.git`. Host is GitHub.
2. What was given? "#40" is a PR number, so the edge goes to "MR forge host?". The host is GitHub, so I take `gh pr view`. I do not call `mr_resolve_branch`, which is the GitLab path. I do not call `skills_resolve`, because no `@key` pointer is needed on this path.
3. `gh pr view 40 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` -> `{"headRefName":"main","headRepositoryOwner":{"login":"someone"},"headRepository":{"name":"app-fork"},"isCrossRepository":true,"state":"OPEN"}`.
4. Pick the branch from the result. The graph says to read the head branch, so it is `main`. It is one branch from a complete read, so I go straight to `git worktree list`.
5. `git worktree list --porcelain` -> `/work/acme` is on `refs/heads/main`. "Branch already checked out?" is yes, so I point there and make no `worktree_provision` call.
6. Report path owner (no further calls). I report that `main` is checked out at `/work/acme`, and I do not enter any worktree.
   - Whose branch: the graph only says to state the owner. `gh pr view` gave the PR's head owner, `someone`, on the fork `app-fork`, and it gave no author field.
   - Caveat I would add: the PR is cross-repository, so its head `main` is the fork's `main`. The local `main` at `/work/acme` is acme/app's own `main`, which is not necessarily the PR's code. The skill has no edge for a cross-repo PR, so I cannot make the checkout correct by following it. I would say so plainly in the report.
   - Safety: I do not commit or push on the branch.

Final report:
"PR #40 (opened, head `main` on someone/app-fork, a cross-repository PR). A worktree on a branch named `main` already exists at /work/acme, so I did not provision a new one and I stayed where I was. Whose branch: the PR head is from `someone`'s fork. Warning: /work/acme is acme/app's own `main`, not the fork's `main`, so it does not hold the PR's changes. This checkout did not fetch the fork. Nothing was committed or pushed."

End node reached: Checked out: path reported (via "Report the path and whose branch it is").
