# GREEN C3: pass (mr_list, mr_resolve_branch iid 31 same repo, worktree_provision rt-77-tidy)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

Ordered calls

1. skills_resolve {id: "widgets:checkout", dir: "<the loaded skill's own directory>"} (no map held yet; use returned paths for each @key; if it fails, stop and say so)
2. Bash: git remote get-url origin -> git@github.com:acme/app.git (forge is GitHub)
3. What was given? A ticket id (RT-77) -> mr_list search edge. No shell gh/glab search.
4. mr_list {repoName: "/work/acme", search: "RT-77", state: "all", limit: 200}
   Result: one row, iid 31, title "RT-77: tidy", sourceBranch rt-77-tidy, state merged, webUrl on github.com, truncated false. A row names the ticket, so no unfiltered second mr_list. Pick branch rt-77-tidy. Exactly one branch from a complete read, so no clarify gate.
5. A GitHub PR row picked? Yes (webUrl on github.com), so resolve it by iid for the fork check and the trees.
   mr_resolve_branch {repoName: "/work/acme", iid: 31}
   Result: state merged, author "me", sourceBranch rt-77-tidy, sourceProjectPath acme/app, trees [].
   Fork check: webUrl owner/repo is acme/app and sourceProjectPath is acme/app. They are equal, so this is not a fork PR. trees is empty, so take the "no tree" edge. This path skips git worktree list.
6. worktree_provision {repoName: "/work/acme", branch: "rt-77-tidy"}
   Result: ok, path /work/acme-rt-77-tidy. Keep the path. Do not enter the worktree.

No gates opened, no run_* calls.

Final report (end node: Checked out: path reported)

Checked out PR #31 (RT-77: tidy, state: merged). Branch `rt-77-tidy` is checked out at /work/acme-rt-77-tidy. It is your own branch (author: me). I stayed in /work/acme and did not enter the worktree. I made no commits or pushes.
