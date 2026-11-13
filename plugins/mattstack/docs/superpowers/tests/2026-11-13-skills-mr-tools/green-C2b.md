# GREEN C2b: pass (sourceProjectPath absent: a repository this token cannot see; ends at Fork PR: reported)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

# green-C2b: "checkout #40"

## Ordered calls

1. `git remote get-url origin` -> `git@github.com:acme/app.git`. The origin URL decides the forge host: GitHub.
2. "What was given?" is a PR number (`#40`), so the edge is `mr_resolve_branch {repoName: "/work/acme", iid: 40}`. I do not read the PR with `gh`: the graph marks that a STOP.
   Result: `webUrl` is `https://github.com/acme/app/pull/40`, `sourceBranch` is `main`, `trees` is `[]`, and there is no `sourceProjectPath` field.
3. `mr_resolve_branch result?` takes the fork-rule check because the `webUrl` is on github.com. The PR's branch is this repo's only when `sourceProjectPath` equals `acme/app`. The field is absent, which the rule says means the token cannot read the head repo. So this is a fork PR.
   - I do not call `worktree_provision`.
   - I do not run `git worktree list`.
   - I do not run `gh pr view`. Its output in the fixtures is a shell read the graph forbids, and the skill does not use it. The fork verdict comes from the result's missing `sourceProjectPath`.
   - The `sourceBranch` of `main` and the empty `trees` do not matter: the fork rule comes first.
4. End at **Fork PR: reported**.

## Final report

#40's branch `main` lives in a fork (a repository this token cannot see), not on origin, so nothing was checked out. The PR is by sam and is opened. No worktree was created and I did not enter any tree.

End node: Fork PR: reported (no human gate reached).
