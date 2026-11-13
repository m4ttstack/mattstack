# GREEN C2b: pass (mr_resolve_branch; sourceProjectPath absent on GitHub; ends at Fork PR: reported; no provision)

Ordered calls

1. skills_resolve {id: "widgets:checkout", dir: "<the loaded skill's own directory>"} (only if no covering map is already held; keys are resolved once per run. If it fails, stop and say so.)
2. Bash: git remote get-url origin
   Result: git@github.com:acme/app.git. The origin host is github.com, so the GitHub fork rule applies later.
3. What was given? "#40" is a PR number, so go to mr_resolve_branch. I do not read the PR with gh (STOP: MR and PR reads go through the read tools), so I do not run the gh pr view fixture.
4. mr_resolve_branch {repoName: "/work/acme", iid: 40}
   Result: iid 40, state opened, author sam, sourceBranch main, webUrl https://github.com/acme/app/pull/40, trees [].
   Check the result:
   - The origin is on github.com, so the fork rule applies.
   - The result has no `sourceProjectPath` key at all. The rule says that when it is absent (the token cannot read the head repo), the result is a fork PR.
   - So I never call worktree_provision. The sourceBranch "main" and the empty trees do not matter. I also skip git worktree list.
   - I do not use the gh output to override this. The branch name main collides with the checkout's own main, which is why the fork check matters.
5. No further calls. End at the node "Fork PR: reported".

Final report

#40's branch `main` lives in a fork (a repository this token cannot see), not on origin, so nothing was checked out. The PR is opened and the author is sam. I made no worktree and did not enter any tree.

End node reached: Fork PR: reported
