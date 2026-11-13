# GREEN C2c: pass (sourceProjectPath null: a deleted fork; ends at Fork PR: reported)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

# green-C2c

Ordered calls

1. `git remote get-url origin` (shell). Prints `git@github.com:acme/app.git`. Origin is GitHub. This is the graph's first node.
2. "What was given?" The input is `#40`, a PR number, so I take the `mr_resolve_branch` edge. I do not read the PR with `gh`. The `gh pr view` and `git worktree list --porcelain` fixtures stay unused.
3. `mr_resolve_branch {repoName: "/work/acme", iid: 40}`. The result is `state: opened`, `author: sam`, `sourceBranch: main`, `webUrl: https://github.com/acme/app/pull/40`, `sourceProjectPath: null`, `trees: []`.
   - The `webUrl` is on github.com, so the fork rule applies.
   - `sourceProjectPath` is null (a deleted fork), which differs from `acme/app`. So this is a fork PR.
   - I do not call `worktree_provision`, even though a fixture exists for it. The branch name `main` also matches a local branch, but that does not matter. I do not run `git worktree list`, because the `mr_resolve_branch` path skips it. I do not enter any tree.
   - The `trees: []` result is irrelevant here, because the fork check comes first.
4. No more calls. I end at the **Fork PR: reported** node. No gate opens and no `run_*` or `gate_*` call is made. I made no `skills_resolve` call either, because this path uses no `@key` pointer.

Final report (verbatim)

`#40`'s branch `main` lives in a fork (a deleted fork), not on origin, so nothing was checked out.

End node: Fork PR: reported. This is a doublecircle node, and no human gate was reached.
