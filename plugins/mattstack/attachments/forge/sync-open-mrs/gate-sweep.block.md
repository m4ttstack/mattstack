---
node: gate_sweep
kind: gate
label: Sweep gate
---

# Gate sweep

Scope `sweep`, once for the whole batch, never per branch. The question:

- `branches` (write-in): a multi-select of the branches to rebase, in
  order, pre-selected by the rule under **Plan the sweep** (deselecting skips
  one); over 4 branches it splits into `branches-1`, `branches-2`, ... of
  up to 4 options each, in order, whose answers read as one union

Selection `{"branches":[...]}`. Nothing is touched before the answer.
Read `next` first: `hold` ends the turn with nothing rebased; `iterate`,
or a write-in that reorders or excludes, goes back to **Plan the sweep**
and ignores `branches`; only `proceed` applies the selection.
`proceed` with an empty `branches` union is "proceed with none selected".
