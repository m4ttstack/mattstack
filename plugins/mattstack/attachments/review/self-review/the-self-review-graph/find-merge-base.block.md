---
node: find_merge_base
---

# Find the self-review merge-base

`git merge-base origin/HEAD HEAD`, or the default branch by name when
`origin/HEAD` is unset. **The self-review diff** runs from that base
through the working tree, uncommitted changes and untracked files
included, built read-only:

1. `git diff <merge base>`: the commits and the uncommitted changes.
2. Then read the NUL-separated paths `git ls-files -z --others
   --exclude-standard` prints, and for each one append `git diff --no-index
   -- /dev/null <path>`. It exits 1 when it prints a diff; that is not a
   failure.

Ignored files stay out. Nothing is staged and no file changes:
never `git add` or `git add -N` to make a new file show up.
