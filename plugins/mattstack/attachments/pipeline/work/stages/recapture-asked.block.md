---
node: recapture_asked
---

# Asked for a new AFTER capture on a run that already shipped?

Yes when the operator wants the AFTER captured again, or the evidence
re-attached, on a pipeline run that is done with its `mr` set. That run is
the one they name: `run_list {repo, pipelines}`, the row with that run id
(or the newest row whose `branch` matches); its `runDb` is
`<runs root>/<the row's repo>/<its id>/state.db`, the runs root
`~/.mattstack/runs` unless `RT_RUNS_ROOT` sets it. The reopen sets it
running at a new ship attempt; resume it, and the ship stage takes its
re-capture route, the operator's ask its attach consent. After ship,
`run_next` walks the later stages again and the close gate asks again. A
run that is still running refuses the reopen: resume it instead.
