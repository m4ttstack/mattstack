# GREEN C3b: pass (mr_list, mr_resolve_branch iid 31 finds the fork; ends at Fork PR: reported; no provision)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# green-C3b

Ordered calls:

1. `git remote get-url origin` (Bash)
   - Result: `git@github.com:acme/app.git`. The forge host is GitHub.
   - "What was given?": a ticket id (`RT-77`), so the next step is `mr_list` with a search. I do not search with `gh`.

2. `mr_list {repoName: "/work/acme", search: "RT-77", state: "all", limit: 200}`
   - Result: one row, iid 31, title "RT-77: tidy", sourceBranch `rt-77-tidy`, state merged, webUrl `https://github.com/acme/app/pull/31`, `truncated: false`.
   - "Search returned a row naming the ticket?": yes (both the title and sourceBranch carry RT-77), so I skip the unfiltered `mr_list`.
   - "Pick the branch from the result": `rt-77-tidy`.
   - "Exactly one branch, from a complete read?": yes. One row, and `truncated` is false.
   - "A GitHub PR row picked?": yes. The row's webUrl is on github.com, so I resolve it by iid to run the fork check. I do not go to `git worktree list`.

3. `mr_resolve_branch {repoName: "/work/acme", iid: 31}`
   - Result: state merged, author sam, sourceBranch `rt-77-tidy`, webUrl `https://github.com/acme/app/pull/31`, sourceProjectPath `someone/app-fork`, trees [].
   - "mr_resolve_branch result?": the webUrl is on github.com, so the fork rule applies. `sourceProjectPath` (`someone/app-fork`) is not the `<owner>/<repo>` in the webUrl (`acme/app`), so this is a fork PR. I do not call `worktree_provision`.
   - End node: **Fork PR: reported**.

I make no other calls: no `worktree_provision`, no `git worktree list`, no `gh`, and no gate.

Final report:

> #31's branch `rt-77-tidy` lives in a fork (`someone/app-fork`), not on origin, so nothing was checked out. (PR #31, "RT-77: tidy", is sam's and is merged.)

End node reached: **Fork PR: reported**.
