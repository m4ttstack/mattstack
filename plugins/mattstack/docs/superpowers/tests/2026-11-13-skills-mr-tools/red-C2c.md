# RED C2c: fails as expected (gh pr view; fork PR reported as acme's own main)

# red-C2c reply

Walk of the checkout graph for "checkout #40", cwd /work/acme.

## Ordered calls

1. `git remote get-url origin` -> `git@github.com:acme/app.git`. The forge host is GitHub.
2. `what_given`: "#40" is a PR number, so the edge goes to `mr_forge_host`, then GitHub, so `gh pr view`. No GitLab tool is called, and `mr_resolve_branch` is skipped because the host is GitHub.
3. `gh pr view 40 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` -> `headRefName: main`, `headRepositoryOwner: someone`, `isCrossRepository: true`, `state: OPEN`.
   - Result: `pick_branch` reads the head branch as `main`.
   - `one_branch`: one branch from a complete read, so the answer is yes.
   - The skill has no edge for a cross-repository (fork) head. I flag this in the report below.
4. `git worktree list --porcelain` -> `/work/acme` is on `refs/heads/main`.
   - `already_checked_out`: a worktree on `main` already exists, so the edge is "yes: point there".
   - `worktree_provision` is not called.
5. `report_path_owner`. I do not enter the worktree.
   - Node reached: **Checked out: path reported**.

## Final report

Branch `main` is checked out at `/work/acme`. This is the existing worktree, and I made no new one.

Whose branch: PR #40 (OPEN) comes from a fork owned by `someone`. The head branch is called `main`. `isCrossRepository` is true.

Caveat: `/work/acme` holds acme/app's own `main`, not the fork's `main` that PR #40 proposes. The names match but the code is not the PR's code. The skill's graph has no fork edge, so I followed it literally and am raising the mismatch here. To review the PR's actual code, the fork's branch would have to be fetched, which this skill does not do.

I did not commit or push, and I did not enter the worktree.
