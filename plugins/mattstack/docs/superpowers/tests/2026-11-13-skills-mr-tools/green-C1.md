# GREEN C1: pass (mr_resolve_branch by URL, same repo, worktree_provision fix-x; no gh)

Ordered calls

1. Bash: `git remote get-url origin` -> `git@github.com:acme/app.git`. Origin is on github.com, so the fork rule applies and the forge is GitHub. Given is a PR link, so "What was given?" takes the "MR or PR link" edge.
2. mr_resolve_branch {repoName: "/work/acme", mrUrl: "https://github.com/acme/app/pull/12"} -> sourceBranch fix-x, state opened, author dana, sourceProjectPath acme/app, trees [].
   - Fork check: webUrl owner/repo is acme/app and sourceProjectPath is acme/app. They are equal, so this is not a fork PR.
   - trees is empty, so the "no tree" edge applies. I skip `git worktree list` and "Branch already checked out?" (this path does not use them).
3. worktree_provision {repoName: "/work/acme", branch: "fix-x"} -> ok, path /work/acme-fix-x. I keep the path and do not enter the worktree.

No gh, no git worktree list, no gate, no skills_resolve (no gate or pointer file needed on this path).

End node: Checked out: path reported (via "Report the path and whose branch it is").

Final report
PR #12 (state: opened) branch `fix-x` is checked out at /work/acme-fix-x. It is dana's branch, not yours. I did not enter the worktree, and I will not commit or push on it.
