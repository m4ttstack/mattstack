---
node: gate_sweep
kind: gate
label: Sweep gate
---

# Gate sweep

Scope `sweep`, once for the whole batch, never per branch. The question:

- `branches` (write-in): a multi-select of the branches to rebase, in
  order, each option `{value: "<branch>", label: "<branch> (Recommended)"}`
  so it starts ticked, per
  the rule under **Plan the sweep** (unticking skips one); one question when the kit form draws the gate (opened from the
  main session, not a subagent or a hand-back, with gate-form's `ask`
  tool (`mcp__gate-form__ask`) in your session); otherwise, over 4
  branches it splits into
  `branches-1`, `branches-2`, ... of up to 4 options each, in order,
  whose answers read as one union

Selection `{"branches":[...]}`. Nothing is touched before the answer.
Read `next` first: `hold` ends the turn with nothing rebased; `iterate`,
or a write-in that reorders or excludes, goes back to **Plan the sweep**
and ignores `branches`; only `proceed` applies the selection.
`proceed` with an empty `branches` union is "proceed with none selected".
