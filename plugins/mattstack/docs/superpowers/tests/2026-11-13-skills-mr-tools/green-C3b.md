# GREEN C3b: pass (mr_list, mr_resolve_branch iid 31 finds the fork; ends at Fork PR: reported; no provision)

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# C3b reply

Ordered calls:

1. `git remote get-url origin` (cwd `/work/acme`)
   Result: `git@github.com:acme/app.git`. The forge host is github.com, so the fork rule applies to any resolved PR.
   "What was given?": a ticket id (`RT-77`), so the next node is the ticket search through the read tools (not `gh pr list`).

2. `mr_list {repoName: "/work/acme", search: "RT-77", state: "all", limit: 200}`
   Result: one row, iid 31, title "RT-77: tidy", sourceBranch `rt-77-tidy`, state merged, `truncated: false`.
   "Search returned a row naming the ticket?": yes (title and sourceBranch both carry RT-77). Pick the branch: exactly one branch, from a complete (not truncated) read.
   "A GitHub PR row picked?": yes (the pick came from an `mr_list` row and origin is on github.com), so resolve the row by its iid for the fork check and trees.

3. `mr_resolve_branch {repoName: "/work/acme", iid: 31}`
   Result: state merged, author sam, sourceBranch `rt-77-tidy`, webUrl `https://github.com/acme/app/pull/31`, sourceProjectPath `someone/app-fork`, trees [].
   Fork check: the `<owner>/<repo>` in webUrl is `acme/app`; sourceProjectPath is `someone/app-fork`, which differs. This is a fork PR: never call `worktree_provision`.

No further calls. I do not call `worktree_provision`, `git worktree list`, `gh`, or any plain-git worktree command.

End node: **Fork PR: reported**

Final report:

> #31's branch `rt-77-tidy` lives in a fork (`someone/app-fork`), not on origin, so nothing was checked out. (PR #31 "RT-77: tidy" is sam's, state merged.)
