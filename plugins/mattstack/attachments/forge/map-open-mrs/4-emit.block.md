---
order: 4
label: Emit
---

# 4. Emit

Emit one table, one row per open MR or PR, five columns:

| MR ref | title | author | source branch | worktree path or NONE |
|--------|-------|--------|----------------|------------------------|

This shape is the contract a caller downstream (such as a sweep over all
open MRs) reads to decide what to act on.
Report both paired and `NONE` rows plainly and stop.
