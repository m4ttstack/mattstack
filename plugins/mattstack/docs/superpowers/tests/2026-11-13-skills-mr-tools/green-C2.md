# GREEN C2: pass (mr_resolve_branch; fork someone/app-fork; ends at Fork PR: reported; no provision)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# C2 reply: "checkout #40"

## Ordered calls

1. `git remote get-url origin` (Bash)
   Result: `git@github.com:acme/app.git`. The forge host is github.com, so the fork rule applies to any PR result.
   "What was given?" -> `#40` is a PR number, so the edge is "an MR or PR link, !iid, #number, or number". No `gh pr view`: PR reads go through the read tools.

2. `mr_resolve_branch {repoName: "/work/acme", iid: 40}`
   Result: `state: opened`, `author: sam`, `sourceBranch: main`, `webUrl: https://github.com/acme/app/pull/40`, `sourceProjectPath: someone/app-fork`, `trees: []`.
   "mr_resolve_branch result?": the origin is on github.com, and the `<owner>/<repo>` in `webUrl` is `acme/app`. `sourceProjectPath` is `someone/app-fork`, which is different, so this is a fork PR. `sourceBranch: main` names the fork's `main`, not origin's. I do not call `worktree_provision` (even though `main` exists locally and the fixture would return a path), I skip `git worktree list`, and I open no gate.

No `skills_resolve` call: no step on this path uses an `@key` pointer.

## End node

**Fork PR: reported**

## Final report

#40's branch `main` lives in a fork (`someone/app-fork`), not on origin, so I checked nothing out. (PR #40 is open and authored by sam.)
