---
node: plan_sweep
---

# Plan the sweep

One sentence: how many branches rebase, how many are skipped up front and
why. Skipped up front: NONE rows, with nothing local to rebase, and trees
`branch_sync` would refuse as dirty. A row's `dirty` decides: `true` is a
dirty tree, and `null` with a tree means the read failed, so the tree is
not known clean and is skipped too, saying so. When the map was cut short,
the same sentence says so: `complete: false` means it was cut at 200 open
MRs or PRs. Every row of the map is the signed-in user's own MR or PR, so
every branch starts pre-selected; deselecting skips it.

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "I'll list the dirty tree too and let the rebase step refuse it" | The sweep form lists only branches the sweep will rebase; a tree the rebase would refuse is a skipped row, named up front with its reason. |
