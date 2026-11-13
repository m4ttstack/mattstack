# GREEN C2c: pass (mr_resolve_branch; sourceProjectPath null on GitHub; ends at Fork PR: reported; no provision)

Ordered calls

1. `git remote get-url origin` -> `git@github.com:acme/app.git`. Origin is on github.com, so the GitHub fork rule applies.
2. "What was given?" is "#40" (a PR number), so I call `mr_resolve_branch {repoName: "/work/acme", iid: 40}`. This skips `git worktree list` and "Branch already checked out?".
   Result: `{"iid":40,"state":"opened","author":"sam","sourceBranch":"main","webUrl":"https://github.com/acme/app/pull/40","sourceProjectPath":null,"trees":[]}`.
3. Result check: the origin is on github.com and `sourceProjectPath` is null (a deleted fork, or a head repo this token cannot read). That makes it a fork PR. I do NOT call `worktree_provision`, and I do not use `gh pr view`, a `git worktree list` fallback, or anything else. `trees: []` and `sourceBranch: "main"` do not change this. A branch named `main` is not this repo's `main`.
4. End node: **Fork PR: reported**.

Final report

`#40`'s branch `main` lives in a fork (a repository this token cannot see), not on origin, so nothing was checked out. The PR is opened, by sam. No worktree was created, and the session stays where it is (`/work/acme`).

End node reached: Fork PR: reported
