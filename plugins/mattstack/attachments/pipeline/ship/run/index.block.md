---
order: 1
---

# Run

```mermaid
flowchart TB
%% name: ship_run
    ship_invoked([Trigger: ship invoked])
    gate_resume_offer
    recapture_asked{Asked for a new AFTER capture on a run that already shipped?}
    find_recapture_run
    run_snapshot_recapture[/"run_snapshot {runDb: <the shipped run>} (re-capture)"/]
    standalone_done{"A done standalone ship run (ship re-capture)?"}
    run_stage_reopen[/"run_stage {runDb: <the shipped run>, action: start, stage: ship, reopen: true}"/]
    reopen_result{"Reopen result (ship)?"}
    not_recaptured_here(((Not re-captured here: name the work verb for a pipeline run, or report the run's status)))
    reopen_refused(((Not reopened: report the refusal and the move it names)))
    revise_asked{Asked to revise a board on a run that already shipped?}
    find_shipped_run
    run_snapshot_shipped[/"run_snapshot {runDb: <the shipped run>}"/]
    revise_board
    revise_outcome{"Revise outcome (ship)?"}
    board_revised(((Board revised: report the new upload)))
    revision_held(((Revision held: end the turn naming the run, the board and the gate)))
    not_revised_no_spec(((Not revised: the board has no bundle; offer a new capture)))
    not_revised_failed(((Not revised: report the failure)))
    run_enter[/"run_enter {flags, skillDir, stage: ship, runDb?, spawnedBy?}"/]
    run_enter_mode{"run_enter mode (ship)?"}
    run_enter_resume[/"run_enter {flags, skillDir, stage: ship, resume: <runId>}"/]
    run_enter_fresh[/"run_enter {flags, skillDir, stage: ship, fresh: true}"/]
    second_run_enter_result{"Second run_enter result (ship)?"}
    run_snapshot[/"run_snapshot {runDb} (resumed ship run)"/]
    inherited_run((("Inherited run: the stage is run.current_stage, close nothing (ship)")))
    held_at_resume_offer(((Held at the ship Resume offer)))
    resumed_run(((Resumed ship run: re-enter at run_snapshot's decisions)))
    resume_refused(((ship run not resumed: report the refusal)))
    start_failed(((ship run not started: report the error)))
    rt_too_old((("rt too old: tell the user to update rt (ship)")))
    own_run_open(((Own ship run open: go to the flow))):::done
    ship_invoked --> recapture_asked
    recapture_asked -->|yes| find_recapture_run
    recapture_asked -->|no| revise_asked
    find_recapture_run --> run_snapshot_recapture
    run_snapshot_recapture --> standalone_done
    standalone_done -->|yes| run_stage_reopen
    standalone_done -->|no: a pipeline run, or not done| not_recaptured_here
    run_stage_reopen --> reopen_result
    reopen_result -->|ok: the own run, reopened for a re-capture| own_run_open
    reopen_result -->|refused| reopen_refused
    revise_asked -->|yes| find_shipped_run
    revise_asked -->|no| run_enter
    find_shipped_run --> run_snapshot_shipped
    run_snapshot_shipped --> revise_board
    revise_board --> revise_outcome
    revise_outcome -->|revised: Recorded, then Attached| board_revised
    revise_outcome -->|held: at evidence-redaction, Record held or Attach held| revision_held
    revise_outcome -->|no spec beside the board| not_revised_no_spec
    revise_outcome -->|a failure: quote it| not_revised_failed
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

An own run is a fresh, resumed or reopened one: it records identity and
closes at the end. An inherited run records no identity, closes nothing, and hands
back to the verb that invoked it.

The flags, rendered by the compiler:

{{run-start.flags:ship}}

`run_enter` takes `flags` = the `ship` flag string above, verbatim (the
value, never its key), `skillDir` = the absolute `folder` your
`skills_resolve` map returned, `stage: ship`, `runDb` only when a caller handed one, and `spawnedBy`
only when a board or another surface launched this pane. It opens the stage
itself. Pass the returned `runDb` to every `run_*` call; nothing is
exported. A handed `runDb` that comes back `handedRunDb: "not-running"`
counts as not handed. Every gate write and `stage` argument is `"ship"` in
an own run and `run.current_stage` in an inherited one.
