---
node: gate_dirty_trees
kind: gate
label: Dirty trees
---

# Gate clarify: dirty trees

Scope `clarify:dirty-trees`, once for the batch of listed branches that
came back `dirty-tree`. One sentence per tree listing its uncommitted
`paths` (when `paths` is absent, quote `refusal` instead). The questions, each its own question:

- `retry`: a multi-select "I committed them, retry" of those branches,
  none pre-selected; over 4 branches it splits into `retry-1`, `retry-2`,
  ... of up to 4 options each, whose answers read as one union
- `next`: **Proceed** (recommended) / **Hold**

Selection `{"retry":[...]}`. Read `next` first: **Hold** ends the turn
with nothing more synced; **Proceed** re-syncs the picked trees once and
leaves the rest skipped (dirty tree, aborted by the human). Never stash.
