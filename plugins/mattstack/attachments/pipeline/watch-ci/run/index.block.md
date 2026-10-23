---
order: 1
---

# Run

```mermaid
flowchart TB
%% name: watch_ci_run
    watch_ci_invoked([Trigger: watch-ci invoked])
    run_enter[/"run_enter {flags, skillDir, stage: watch-ci, runDb?, spawnedBy?}"/]
    run_enter_mode{"run_enter mode (watch-ci)?"}
    gate_resume_offer
    run_enter_resume[/"run_enter {flags, skillDir, stage: watch-ci, resume: <runId>}"/]
    run_enter_fresh[/"run_enter {flags, skillDir, stage: watch-ci, fresh: true}"/]
    second_run_enter_result{"Second run_enter result (watch-ci)?"}
    run_snapshot[/"run_snapshot {runDb} (resumed watch-ci run)"/]
    inherited_run((("Inherited run: the stage is run.current_stage, close nothing (watch-ci)")))
    held_at_resume_offer(((Held at the watch-ci Resume offer)))
    resumed_run(((Resumed watch-ci run: re-enter at run_snapshot's decisions)))
    resume_refused(((watch-ci run not resumed: report the refusal)))
    start_failed(((watch-ci run not started: report the error)))
    rt_too_old((("rt too old: tell the user to update rt (watch-ci)")))
    own_run_open(((Own watch-ci run open: go to the flow))):::done
    watch_ci_invoked --> run_enter
    run_enter --> run_enter_mode
    run_enter_mode -->|inherited| inherited_run
    run_enter_mode -->|started| own_run_open
    run_enter_mode -->|resumed| run_snapshot
    run_enter_mode -->|candidates| gate_resume_offer
    run_enter_mode -->|tool error| start_failed
    run_enter_mode -->|no run_enter tool at all| rt_too_old
    gate_resume_offer -->|resume| run_enter_resume
    gate_resume_offer -->|start fresh| run_enter_fresh
    gate_resume_offer -->|hold| held_at_resume_offer
    run_enter_resume --> second_run_enter_result
    run_enter_fresh --> second_run_enter_result
    second_run_enter_result -->|resumed| run_snapshot
    second_run_enter_result -->|started| own_run_open
    second_run_enter_result -->|resume refused| resume_refused
    second_run_enter_result -->|fresh start errored| start_failed
    run_snapshot --> resumed_run
```

An own run is a fresh or resumed one: it records identity, fires every gate
below and closes at the end. An inherited run fires no gate beyond `ci` and
the off-script gates, records no identity, and hands back. Its caller hands
`mr` (the MR's or PR's URL), `sha` and optionally `priorPipelineId` (a
number), and gets back one of: green, red after the `ci` gate, an
off-script answer, a failure, a stand-down naming the `holder`, or a hold.

The flags, rendered by the compiler:

{{run-start.flags:watch-ci}}

`run_enter` takes `flags` = the `watch-ci` flag string above, verbatim (the
value, never its key), `skillDir` = `${CLAUDE_SKILL_DIR}` as an absolute
path, `stage: watch-ci`, `runDb` only when a caller handed one, and
`spawnedBy` only when a board or another surface launched this pane. It
opens the stage itself. Pass the returned `runDb` to every `run_*` call;
nothing is exported. A handed `runDb` that comes back `handedRunDb:
"not-running"` counts as not handed. Every gate write and `stage` argument
is `"watch-ci"` in an own run and `run.current_stage` in an inherited one.
