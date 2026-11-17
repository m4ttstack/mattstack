---
node: answered_by_mode
---

# Take the mode's answer

The `paneAction: answered` branch: the run's gate mode covered the reach
this site declared and took every question's recommended option. The gate
is already answered, with the result's `decidedBy` reading `mode:<mode>`.
Where a site passes "the gate result's `decidedBy`", that is this value; a
call whose graph node writes its own decider (`decidedBy: stage-plan`)
keeps it. When the result carries `runErrors`, the run decision did not
save: call `gate_reconcile {id, runDb, stage}` once (adding the `scope`
the open passed, when it passed one), which records the answer as the
run's decision under the same `mode:<mode>` decider. Its result recorded
the decision when it reads `recorded: true` or `alreadyReconciled: true`;
then act. Any other result (its own `runErrors`, a refusal, an error)
means the decision is still unrecorded: quote that error as the
`run_hold` reason and end the turn held, with nothing acted on. Act on
the result's `answers` and `next` at the site, exactly as if the human had
picked them: the site's `Read next` and Selection lines route them. Never
open the gate again, never present it (no form, no AskUserQuestion, no
wait), and never call `gate_answer` on it, whether the reconcile recorded
or not.
