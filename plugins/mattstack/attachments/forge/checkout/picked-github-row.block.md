---
node: picked_github_row
---

# A GitHub PR row picked?

Yes when the pick came from an `mr_list` row and the origin URL is on
github.com: resolve that row by its `iid` with `mr_resolve_branch`, so it
gets the fork check and the trees on its branch. A branch name given
verbatim, or any pick on GitLab, is no and goes to `git worktree list`.
