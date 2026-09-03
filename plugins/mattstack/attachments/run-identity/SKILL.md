---
name: run-identity
description: "Use when a standalone verb has just resolved the target its run is about -- recording the run's ticket, branch, and mr fields so the console board and run detail can show them."
type: pipeline-step
---

# Run identity

A run's identity is three fields: `ticket`, `branch`, `mr`. They are the
same keys the pipeline stages produce, and the console reads them from
every run: the board row shows `ticket` and `branch`, the run detail card
shows all three. Nothing backfills them: a field not recorded while the
run is live reads "not recorded" forever.

Record identity only when this verb ran `run-start`. An inherited run's
identity belongs to the verb that started it, and must not be overwritten
with the target of a review or a watch invoked mid-run.

When the run is yours, record each key the moment the target-resolution
step produces it: `rt runs field set <key> <value> --stage <verb>`.

Skip a key the target does not have: a branch with no ticket records no
`ticket`. Never guess a value, and never block on a missing one.
