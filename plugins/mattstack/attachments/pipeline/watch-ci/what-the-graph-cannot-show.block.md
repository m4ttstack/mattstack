---
order: 3
---

# What the graph cannot show

- **The watched sha and prior id.** The caller's `sha` and
  `priorPipelineId`, or this run's `git_push` result's; after a confirmed
  human push, its HEAD and no prior id; with no push, the remote branch's
  sha (`git ls-remote`): unpushed commits have no pipeline. `<sha12>` is its
  first 12 characters. Pass the prior id on the first `ci_watch` for a sha,
  then any a result carries; never the watched pipeline's own
  `pipeline.id`. A non-null `mr` in the `git_push` result is the MR to
  watch.
- **The watch window.** `ci_watch {attend: true}` owns `timeout`
  (`ci.watch.budgetMinutes`, reopened itself) and `no_pipeline` (10 minutes
  with no pipeline, or one proved not this commit's): pass no budget
  arguments. An unprovable `waiting` (a merge train with no prior id, an
  unread commit) gets neither: `waiting-results` counts it.
- **The sha guard.** `ci_watch` counts only a pipeline for `sha` and
  returns `superseded` when the head moves past it. On GitHub, `headRefOid`
  must equal the watched sha, "no checks reported" is pending, and
  `gh run rerun` takes the run id in the failed check's link.
- **The new attempt.** A fix push in an own run starts the next attempt of
  `watch-ci` with `run_resolve` (`next: iterate`, `to` left out), never
  `run_stage` start: `attempt` is the attempt now running (`run_enter`'s
  `at.attempt`, or the last `run_resolve`'s `next.attempt`), which the `ci`
  gate's scope carries (an off-script gate's `<n>` counts its rounds, not
  attempts); `decidedBy` is the answer that sent you to push (the `ci` gate's
  **Fix and re-push**, or the `git_push` off-script gate's Take), and
  `note` is `fix pushed: <sha12>`. The next `ci` gate's scope carries the
  new attempt. An inherited run writes nothing: the caller's stage is not
  this verb's to restart.
- **Holding.** `run_hold` takes the gate-write stage, the gate as `reason`,
  and `decidedBy` as the answer recorded it.
