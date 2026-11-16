---
node: answered_by_mode
---

# Take the mode's answer

The `paneAction: answered` branch: the run's gate mode covered the reach
this site declared and took every question's recommended option. The gate
is already answered and recorded, with the result's `decidedBy` reading
`mode:<mode>`. Where a site passes "the gate result's `decidedBy`" (a
hold, a hand-back), that is this value; a call whose graph node writes
its own decider (`decidedBy: stage-plan`) keeps it. Act on the result's `answers` and `next` at the site,
exactly as if the human had picked them: the site's `Read next` and
Selection lines route them. Never open the gate again, never present it
(no form, no AskUserQuestion, no wait), and never call `gate_answer` or
`gate_reconcile` on it.
