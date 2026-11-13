# GREEN C2d: pass (alias origin; mr_resolve_branch by URL; webUrl on github.com; ends at Fork PR: reported; no provision)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# C2d run

Pointer resolution: this path uses no `@key`, so I make no `skills_resolve` call.

## Calls

1. `git remote get-url origin` (Bash)
   - Result: `git@work-github:acme/app.git`. This is an SSH alias, so the host is not visible from the URL alone. The skill says the `webUrl` decides whether the result is a GitHub one, and an SSH-alias origin still gives a github.com `webUrl`.
   - What was given? A PR link, so the next step is `mr_resolve_branch`. I do not use `gh pr view` (STOP: MR and PR reads go through the read tools).

2. `mr_resolve_branch {repoName: "/work/acme", mrUrl: "https://github.com/acme/app/pull/40"}`
   - Result: `{"iid": 40, "state": "opened", "author": "sam", "sourceBranch": "main", "webUrl": "https://github.com/acme/app/pull/40", "sourceProjectPath": "someone/app-fork", "trees": []}`
   - `webUrl` is on github.com, so the fork rule applies. The `<owner>/<repo>` in `webUrl` is `acme/app`, but `sourceProjectPath` is `someone/app-fork`. They differ, so this is a fork PR.
   - The empty `trees` does not matter, and neither does `sourceBranch: "main"` matching a local `main`: the branch lives in a fork. I do not call `worktree_provision`, and I do not run `git worktree list` (this path skips it).

End node: **Fork PR: reported**

## Final report

#40's branch `main` lives in a fork (`someone/app-fork`), not on origin, so nothing was checked out.

The PR is opened and is sam's. No worktree was created, and the session stays in `/work/acme`.
