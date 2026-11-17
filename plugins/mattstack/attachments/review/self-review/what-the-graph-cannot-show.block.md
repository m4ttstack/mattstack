---
order: 3
label: Graph notes
---

# What the graph cannot show

- Where the domain defines ship-time gates, this self-review complements
  them and never checks their box.
- A hold is the one `run_hold` call: your stage, the developer's words as
  `reason` (a write-in riding on the hold included), the answer's by as
  `decidedBy`. Then the turn ends.
- `run_close` takes `outcome: done` once the selected fixes are verified,
  and then the calling flow continues (ship, or the next task); or
  `outcome: abandoned` with `reason: <their words>` on an abandon or a
  hand back.
- Before the close, the final message lists every finding as fixed, not
  reproduced (with its test), a judgment call (with the reviewer's
  reason), owed evidence (with what to capture), or left open.
- A hold on spent `rereview-rounds` names the fix round no re-review
  covered; closing with that round unreviewed is not an option.
