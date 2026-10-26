---
node: find_merge_base
---

# Find the self-review merge-base

`git merge-base origin/HEAD HEAD`, or the default branch by name when
`origin/HEAD` is unset. The diff runs from that base through the working
tree, uncommitted changes included.
