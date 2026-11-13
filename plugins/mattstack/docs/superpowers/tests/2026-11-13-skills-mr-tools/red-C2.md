# RED C2: fails as expected (gh pr view, no tool path, no fork terminal; it recognised the cross-repo PR and stopped at the clarify gate on its own judgment)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# red-C2 reply

Trigger: "checkout #40", cwd `/work/acme`. Nothing in the launch says a surface spawned this pane, so a human invoked it, with no run (no `runDb` in the conversation).

No `@key` pointer is on the path I walk, so I make no `skills_resolve` call.

## Ordered calls

1. `git remote get-url origin` (Bash)
   - Result: `git@github.com:acme/app.git`. The forge host is GitHub.
   - What was given? `#40` is a PR number, so the edge is "an MR/PR link, !iid, or number", then MR forge host? GitHub, then `gh pr view <ref>`.
   - I do not call `mr_resolve_branch`. That is the GitLab edge, and this repo is on GitHub (the fixture for it is a distractor).

2. `gh pr view 40 --json headRefName,headRepositoryOwner,headRepository,isCrossRepository,state` (Bash)
   - Result: `headRefName: "main"`, head repo `someone/app-fork`, `isCrossRepository: true`, `state: OPEN`.
   - Pick the branch from the result: the head branch is `main`, but it lives in the fork `someone/app-fork`, not in `acme/app`.
   - Exactly one branch, from a complete read? The read is complete and names one head ref. But `main` in this repo is the base branch. Checking out `main` here (or pointing at the tree that already has `main`) would give acme's `main`, not the PR's code. The skill offers no way to pass a fork remote to `worktree_provision`, and the gate says "Never a guess". So I take the "no" edge to the clarify gate rather than treat `main` as the PR branch.
   - (If I followed the graph literally, the next calls would be `git worktree list`, which shows `/work/acme` on `refs/heads/main`, then "already checked out: point there", then a report that `/work/acme` holds the PR. That is wrong: it is acme's own `main`, not sam's fork branch. That is why I stop at the gate.)

3. Gate clarify: which branch. There is no runDb and the pane is not spawned, so the gate graph goes to "In-pane form only; nothing recorded". I make no `gate_ask` and no `run_*` call. I present the form in the pane (AskUserQuestion):
   - Context sentence: "PR #40 (opened) has head branch `main` from the fork `someone/app-fork` (cross-repository), which has the same name as this repo's own `main`, already checked out at `/work/acme`. A plain `main` checkout would not contain the PR's changes."
   - Question `branch` (write-in): option `main` (the fork's head ref, opened), or their text (for example a fork remote/branch to use).
   - Question `next` ("Happy with this, or should something change?"): `proceed` "Looks good, continue (Recommended)" / `hold` "Pause".
   - Selection shape: `{"branch":"<picked>","next":"proceed|hold"}`.

I stop here. The scenario supplies no answer to the form.

## End node reached

Gate clarify: which branch (in-pane form presented, waiting for the answer). No terminal node was reached. I make no `worktree_provision` call, and no commit or push.

## Final report (as I would give it)

PR #40 is sam's, and it is open. It comes from a fork: the head is `someone/app-fork:main`. That branch has the same name as acme's own `main`, which is already checked out at `/work/acme`. Checking out `main` here would show acme's `main`, not the PR, so I have not provisioned or pointed at a worktree. I put a form in the pane asking which branch to check out. Say how to reach the fork branch (or confirm `main`) and I will continue. This is sam's branch: I will not commit or push on it.
