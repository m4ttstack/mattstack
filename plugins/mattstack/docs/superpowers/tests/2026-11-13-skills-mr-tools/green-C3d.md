# GREEN C3d: pass (alias origin; mr_list, mr_resolve_branch iid 31; ends at Fork PR: reported; no provision)

Rerun after the final-review fix wave (5f7592cf2: GitHub fork check keys on webUrl).

Test agent: Opus, medium effort (Sonnet runs were stopped by model safeguards; shepherd gate 2c3d2d46).

# green-C3d

No `@key` pointer is used on this path, so I make no `skills_resolve` call.

## Calls

1. `git remote get-url origin` (Bash)
   - Prints `git@work-github:acme/app.git`. That is an SSH alias, so the forge host is not settled yet. The fork rule keys on the result's `webUrl`, not on this URL.
   - What was given? A ticket id (`RT-77`), so I go to `mr_list` with the search. I do not use `gh pr list`, because ticket searches go through the read tools.

2. `mr_list {repoName: "/work/acme", search: "RT-77", state: "all", limit: 200}`
   - It returns one row: iid 31, title `RT-77: tidy`, sourceBranch `rt-77-tidy`, state merged, webUrl `https://github.com/acme/app/pull/31`. `truncated: false`.
   - Did the search return a row naming the ticket? Yes: both the title and `sourceBranch` carry RT-77. So I skip the unfiltered second `mr_list`.
   - Pick the branch: exactly one branch (`rt-77-tidy`), and the read is complete (not truncated). The answer is yes.
   - Was a GitHub PR row picked? Yes: the row's `webUrl` is on github.com. So I resolve the row by its iid to get the fork check, and I do not go to `git worktree list`.

3. `mr_resolve_branch {repoName: "/work/acme", iid: 31}`
   - It returns state merged, author `sam`, sourceBranch `rt-77-tidy`, webUrl `https://github.com/acme/app/pull/31`, sourceProjectPath `someone/app-fork`, trees `[]`.
   - mr_resolve_branch result? The `webUrl` is on github.com, so the fork rule applies. The `<owner>/<repo>` in the `webUrl` is `acme/app`, and `sourceProjectPath` is `someone/app-fork`. They differ, so this is a fork PR.
   - I never call `worktree_provision`. I do not use `gh pr view` either.

End node: **Fork PR: reported**

## Final report

`#31`'s branch `rt-77-tidy` lives in a fork (`someone/app-fork`), not on origin, so nothing was checked out.

(PR #31, "RT-77: tidy", is sam's and is merged. No worktree was created, and this session stays where it is.)
