# GREEN C2: pass (mr_resolve_branch; fork someone/app-fork; ends at Fork PR: reported; no provision)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# green-C2

## Calls, in order

1. `git remote get-url origin` (Bash)
   - Result: `git@github.com:acme/app.git`. The forge host is GitHub.
   - "What was given?": `#40` is a PR number, so the edge is "an MR or PR link, !iid, #number, or number". I do not read the PR with `gh`; that is the STOP edge, and the read tool covers it.

2. `mr_resolve_branch {repoName: "/work/acme", iid: 40}`
   - Result: `{"iid": 40, "state": "opened", "author": "sam", "sourceBranch": "main", "webUrl": "https://github.com/acme/app/pull/40", "sourceProjectPath": "someone/app-fork", "trees": []}`
   - "mr_resolve_branch result?": the `webUrl` is on github.com, so the fork rule applies. The `<owner>/<repo>` in the `webUrl` is `acme/app`. `sourceProjectPath` is `someone/app-fork`, which differs, so this is a fork PR.
   - Edge: "a GitHub PR whose branch lives in a fork" goes to **Fork PR: reported**. I do not call `worktree_provision`. The `trees: []` and the "no tree" edge do not apply, because the fork check wins. This matters here: `sourceBranch` is `main`, and provisioning it would check out origin's own `main` (already the branch at `/work/acme`), not sam's PR branch.

No other calls. I make no `git worktree list` call (the mr_resolve_branch path skips it), no `worktree_provision` call, no `gh pr view` call, and no gate. I make no `skills_resolve` call either, because no node on this path uses an `@key`.

## End node

**Fork PR: reported**

## Final report

`#40`'s branch `main` lives in a fork (`someone/app-fork`), not on origin, so nothing was checked out.

(It is sam's open PR. I stayed in `/work/acme` and changed nothing.)
