---
node: all_selected
---

# Every listed branch selected?

`branch_sync_sweep` reads its own MR list and syncs (and pushes) every
branch of yours that has a tree, not the form's list. So the answer is yes
only when all four hold:

- the map was complete (`mr_map`'s `complete` is true on GitLab; fewer
  than 200 rows from `gh pr list` on GitHub),
- the plan skipped no tree up front (no `dirty: true`, no `dirty: null`
  with a worktree on GitLab, no non-empty porcelain read on GitHub), so
  the sweep visits no tree outside the form; a NONE row does not count,
- every listed branch is selected,
- the answer asked for no reorder.

Anything else is no: the per-branch path, one `branch_sync {tree}` per
selected branch in the answer's order.
