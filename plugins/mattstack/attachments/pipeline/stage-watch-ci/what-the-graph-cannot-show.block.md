---
order: 1
label: Graph notes
---

# What the graph cannot show

- **The pushed sha.** The ship stage writes `pushed` = `{"sha",
  "priorPipelineId"}`; `<sha12>` is the sha's first 12 characters.
  A `priorPipelineId` a result carries goes on the next call; the watched
  pipeline's own `pipeline.id` never does. Both `pushed set` edges say what to pass.
- **The watch window.** `ci_watch` owns `timeout`
  (`ci.watch.budgetMinutes`) and `no_pipeline` (10 minutes with no pipeline,
  or one proved not this commit's): pass no budget arguments. An unprovable
  `waiting` (a merge train with no prior id, an unread commit) gets neither:
  `waiting-results` counts it.
- **The sha guard.** `ci_watch` counts only a pipeline for `sha` and
  returns `superseded` when the head moves on. On GitHub `headRefOid` must equal it, "no checks reported" is
  pending, and `gh run rerun` takes the run id from the failed check's link.
- **Hold.** `run_hold` takes the gate as `reason` and `decidedBy` as the
  answer recorded it.
