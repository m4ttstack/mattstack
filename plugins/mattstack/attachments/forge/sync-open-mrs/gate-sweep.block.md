---
node: gate_sweep
kind: gate
label: Sweep gate
---

# Gate sweep

Scope `sweep`, once for the whole batch, never per branch. The questions,
each its own question (never fold one list into another: a question over 4
options sends the whole gate to the wait queue):

- `branches`: a multi-select of the branches to rebase, in order,
  pre-selected by the rule under **Plan the sweep** (deselecting skips
  one); over 4 branches it splits into `branches-1`, `branches-2`, ... of
  up to 4 options each, in order, whose answers read as one union
- `next`: **Proceed** (recommended) / **Iterate here** (their text
  reorders or excludes) / **Hold**

Selection `{"branches":[...]}`. Nothing is touched before the answer.
Read `next` first: **Hold** ends the turn with nothing rebased; **Iterate
here** goes back to **Plan the sweep** and ignores `branches`; only
**Proceed** applies the selection.
**Proceed** with an empty `branches` union is "proceed with none selected".
