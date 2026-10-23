---
node: record_sweep_result
---

# Record every sweep result in its bucket

Each entry of `results` goes into its bucket by the table under **Record
the branch in its bucket**; each `noTree` row is skipped: no worktree.
`complete: false` is one report line: the forge may have cut the MR list
short. A result for a branch the map did not list (an MR opened after the
map) lands in its bucket like any other and the report names it as one the
map did not list.
