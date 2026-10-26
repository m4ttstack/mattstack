---
node: find_shipped_run
---

# Find the shipped run (ship)

The operator asks to change a board on a run that already shipped
(reword a label, widen a redaction). A `runDb` a caller handed is the
shipped run. Otherwise it is the run the operator names: `run_list
{repo}`, the row with that run id, or the newest row whose `branch`
matches when they name only the branch. Its `runDb` is
`<runs root>/<the row's repo>/<its id>/state.db`, the runs root
`~/.mattstack/runs` unless `RT_RUNS_ROOT` sets it.
