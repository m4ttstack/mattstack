---
name: work
disable-model-invocation: true
description: "Use when running a unit of work end to end through a pack's compiled pipeline -- 'run the feature pipeline', 'do this ticket end to end', 'start a unit of work'."
allowed-tools:
  - Bash(git -C *:*)
type: pipeline-step
slots:
  tiering: { contract: model-tiering@1, required: false }
---

# work -- the pipeline orchestrator

You run one unit of work through the stages below. The graph is the run:
treat a move it does not show as a question for a gate, never a judgment
call. Reads are part of the step that needs them, not moves. Every call
after `run_enter` passes the `runDb` it returned.

## Stages

The run engine walks them in this order.

{{pipeline.table}}

`run_enter`'s `flags` is the `work` value below, verbatim; `skillDir` is
`${CLAUDE_SKILL_DIR}`, absolute:

{{run-start.flags:work}}

```dot
digraph work {
    work_triggered [label="Trigger: run a unit of work" shape=ellipse];
    recapture_asked [label="Asked for a new AFTER capture on a run that already shipped?" shape=diamond];
    run_stage_reopen [label="run_stage {runDb: <the shipped run>, action: start, stage: ship, reopen: true}" shape=plaintext];
    reopen_result [label="Reopen result?" shape=diamond];
    stop_reopen_refused [label="STOP: report the reopen refusal and the move it names" shape=octagon style=filled fillcolor=red fontcolor=white];
    run_id_in_context [label="A running run's id in context this request continues?" shape=diamond];
    existing_work [label="Existing work?" shape=diamond];
    run_list [label="run_list {repo, pipelines}" shape=plaintext];
    running_run_listed [label="A running run listed?" shape=diamond];
    gate_resume_or_fresh [label="Gate clarify, AskUserQuestion only: Resume it / Start fresh / Hold" shape=box];
    clarify_answer [label="clarify answer?" shape=diamond];
    run_enter_resume [label="run_enter {flags, skillDir, resume: <runId>, spawnedBy?}" shape=plaintext];
    run_enter_fresh [label="run_enter {flags, skillDir, ticket?, spawnedBy?, fresh: true}" shape=plaintext];
    run_enter_result [label="run_enter result?" shape=diamond];
    stop_run_enter_missing [label="STOP: report the tool's message; no run_enter tool means rt needs an update" shape=octagon style=filled fillcolor=red fontcolor=white];
    ticket_named [label="Ticket named?" shape=diamond];
    tracker_in_progress [label="Tracker: In Progress, assigned to the operator" shape=box];
    account_picked [label="Account picked at spawn?" shape=diamond];
    run_decision_account [label="run_decision {contract: account-pool@1, scope: run, selection, decidedBy}" shape=plaintext];
    run_field_get_waiting_gate [label="run_field_get {key: waiting-gate}" shape=plaintext];
    waiting_gate_set [label="waiting-gate set?" shape=diamond];
    gate_reconcile [label="gate_reconcile {id, runDb, stage}" shape=plaintext];
    run_field_set_waiting_gate [label="run_field_set {key: waiting-gate, value: -, stage}" shape=plaintext];
    armed_gate_status [label="Armed gate's status?" shape=diamond];
    failure_or_close_gate [label="A failure or close gate?" shape=diamond];
    rt_gate_wait [label="rt gate wait <id> as a background Bash task" shape=plaintext];
    reenter_at_gate [label="Re-enter the stage at that gate's site" shape=box];
    at_status [label="at.status?" shape=diamond];
    follow_stage_file [label="Read the stage file at the position and follow it" shape=box];
    stage_file_ended [label="How did the stage file end?" shape=diamond];
    run_next [label="run_next {runDb, stage}" shape=plaintext];
    run_next_ended [label="run_next ended?" shape=diamond];
    gate_stage_failed [label="Gate <stage>-failed:<attempt>" shape=box];
    gate_close [label="Gate close" shape=box];
    run_resolve_next [label="run_resolve {runDb, stage, next, to?, note?, attempt, decidedBy}" shape=plaintext];
    run_resolve_redirect [label="run_resolve {runDb, stage, next: redirect, to, note, attempt, decidedBy}" shape=plaintext];
    run_resolve_result [label="run_resolve result?" shape=diamond];
    run_hold_refusal [label="run_hold {runDb, stage, reason: <the refusal>, decidedBy: pane}" shape=plaintext];
    run_hold_result [label="run_hold result?" shape=diamond];
    stop_run_hold_refused [label="STOP: report the run_hold refusal" shape=octagon style=filled fillcolor=red fontcolor=white];
    held [label="Held" shape=doublecircle];
    ended_at_gate [label="Ended at the gate" shape=doublecircle];
    run_closed [label="Run closed" shape=doublecircle];
    run_abandoned [label="Run abandoned" shape=doublecircle];
    run_done [label="Run done" shape=doublecircle style=filled fillcolor=lightgreen];

    work_triggered -> recapture_asked;
    recapture_asked -> run_stage_reopen [label="yes"];
    recapture_asked -> run_id_in_context [label="no"];
    run_stage_reopen -> reopen_result;
    reopen_result -> run_enter_resume [label="ok: resume that run"];
    reopen_result -> stop_reopen_refused [label="refused"];
    run_id_in_context -> run_enter_resume [label="yes"];
    run_id_in_context -> existing_work [label="no"];
    existing_work -> run_list [label="yes"];
    existing_work -> run_enter_fresh [label="no, or spawnedBy set"];
    run_list -> running_run_listed;
    running_run_listed -> gate_resume_or_fresh [label="yes"];
    running_run_listed -> run_enter_fresh [label="no"];
    gate_resume_or_fresh -> clarify_answer;
    clarify_answer -> run_enter_resume [label="resume"];
    clarify_answer -> run_enter_fresh [label="start fresh"];
    clarify_answer -> held [label="hold"];
    run_enter_resume -> run_enter_result;
    run_enter_fresh -> run_enter_result;
    run_enter_result -> ticket_named [label="started, or resumed at the first stage's attempt 1"];
    run_enter_result -> run_field_get_waiting_gate [label="resumed elsewhere"];
    run_enter_result -> stop_run_enter_missing [label="refused or error"];
    ticket_named -> tracker_in_progress [label="yes"];
    ticket_named -> account_picked [label="no"];
    tracker_in_progress -> account_picked;
    account_picked -> run_decision_account [label="yes"];
    account_picked -> run_field_get_waiting_gate [label="no"];
    run_decision_account -> run_field_get_waiting_gate;
    follow_stage_file -> stage_file_ended;
    run_field_get_waiting_gate -> waiting_gate_set;
    waiting_gate_set -> gate_reconcile [label="yes"];
    waiting_gate_set -> at_status [label="no: not set, or -"];
    gate_reconcile -> armed_gate_status;
    armed_gate_status -> failure_or_close_gate [label="answered or late"];
    armed_gate_status -> rt_gate_wait [label="open"];
    armed_gate_status -> at_status [label="closed"];
    armed_gate_status -> run_field_set_waiting_gate [label="not found"];
    run_field_set_waiting_gate -> at_status;
    armed_gate_status -> run_hold_refusal [label="refused"];
    failure_or_close_gate -> run_resolve_next [label="yes"];
    failure_or_close_gate -> reenter_at_gate [label="no"];
    rt_gate_wait -> ended_at_gate;
    reenter_at_gate -> stage_file_ended;
    at_status -> follow_stage_file [label="running"];
    at_status -> run_next [label="failed or done"];
    stage_file_ended -> run_next [label="returned, failed, held or abandoned (run_next routes them)"];
    stage_file_ended -> run_resolve_redirect [label="handed back a Go back or a Fix (a redirect)"];
    run_next -> run_next_ended;
    run_next_ended -> follow_stage_file [label="done, next"];
    run_next_ended -> gate_close [label="done, last"];
    run_next_ended -> gate_stage_failed [label="failed"];
    run_next_ended -> held [label="held or waiting"];
    run_next_ended -> run_closed [label="closed"];
    run_next_ended -> run_hold_refusal [label="refused"];
    gate_stage_failed -> run_resolve_next;
    gate_close -> run_resolve_next;
    run_resolve_next -> run_resolve_result;
    run_resolve_redirect -> run_resolve_result;
    run_resolve_result -> follow_stage_file [label="retry, redirect or iterate"];
    run_resolve_result -> held [label="hold"];
    run_resolve_result -> run_abandoned [label="abandon"];
    run_resolve_result -> run_done [label="done"];
    run_resolve_result -> run_hold_refusal [label="refused"];
    run_hold_refusal -> run_hold_result;
    run_hold_result -> held [label="held"];
    run_hold_result -> stop_run_hold_refused [label="refused"];
}
```

### Asked for a new AFTER capture on a run that already shipped?

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

### Gate clarify, AskUserQuestion only: Resume it / Start fresh / Hold

No run exists yet: no `gate_*` or `run_*` call. Offer the newest
`run_list` row. `run_list`'s `pipelines` is {{run-list.pipelines}}; only those runs are offered to resume.
Never `run_enter`'s candidates, which ignore that filter. Starting fresh
leaves that run untouched.

### Tracker: In Progress, assigned to the operator

For Linear: `save_issue` with state In Progress and assignee `me`. Never
fabricate a ticket.

### Read the stage file at the position and follow it

The position is the last result's `at` or `next`; read its absolute `file`
from the top and follow it to its end.

### Re-enter the stage at that gate's site

Read the stage file, go to the site of that gate's scope, and continue at
gate-protocol's `A write-in to act on (actOnWriteIn)?` with the recorded
answers, never re-asking; then walk every node after that gate.

### Gate <stage>-failed:<attempt>

Scope from `run_next`, `stage` the failed stage. Above the form: the
stage, `reason` and `detailPath`.

### Gate close

`stage` is the last stage. Above the form: the MR link, its state and the
`ci` verdict.

## A board frame mid-run

The board rings this session instead of launching a doctor while the run
is live. The frame arrives as a `<cross-session-message
from-name="board">` naming an MR: this run's own MR (`CI failed on
!<iid>`, `!<iid> needs a rebase onto <target>`) or one stacked on this
branch (`!<iid> (stacked on your branch) ...`). Walk this map, then carry
on from the step you left.

```dot
digraph board_frame {
    board_frame_arrived [label="Trigger: a frame from board arrives mid-run" shape=ellipse];
    own_mr_in_watch_ci [label="About this run's own MR, with watch-ci the current stage?" shape=diamond];
    frame_kind [label="Which frame?" shape=diamond];
    stop_board_handoff [label="STOP: the frame is this stage's work; no gate, reply or doctor" shape=octagon style=filled fillcolor=red fontcolor=white];
    ci_triage_own [label="ci_triage {mrUrl: <this run's MR>, pipelineId: <the frame's pipeline>}" shape=plaintext];
    own_real_job [label="A REAL job failing on this run's MR?" shape=diamond];
    git_rebase_own [label="git_rebase {tree: <worktree>, onto: origin/<the frame's target>}" shape=plaintext];
    rebase_status [label="Board rebase status?" shape=diamond];
    run_budget_conflicts [label="run_budget {runDb, key: board:conflict-rounds, limit: 4, stage}" shape=plaintext];
    conflict_rounds_spent [label="Board conflict-rounds spent?" shape=diamond];
    resolve_board_conflicts [label="Resolve the files, then continue the board rebase on Bash" shape=box];
    continue_status [label="Board rebase continue result?" shape=diamond];
    git_rebase_abort [label="git_rebase {tree: <worktree>, abort: true}" shape=plaintext];
    rerun_after_rebase [label="Rerun the stage's tests on the rebased branch" shape=box];
    rebased_green [label="Green on the rebased branch?" shape=diamond];
    ci_triage_stacked [label="ci_triage {mrUrl: <the stacked MR>, pipelineId: <the frame's pipeline>}" shape=plaintext];
    judge_stacked_cause [label="Judge whether this branch's change caused the stacked MR's failure" shape=box];
    stacked_cause [label="This branch's change caused it?" shape=diamond];
    fix_on_my_branch [label="Fix it test-first and commit on this run's branch" shape=box];
    fix_green [label="Fixed, with the stage's tests green?" shape=diamond];
    run_field_set_board_note [label="run_field_set {runDb, key: board-<the frame's iid>, value: <one-line note>, stage}" shape=plaintext];
    run_stage_fail_board [label="run_stage {runDb, action: fail, stage: <current stage>, reason}" shape=plaintext];
    stage_failed [label="The stage ended failed; run_next routes it" shape=doublecircle];
    back_in_stage [label="Back at the step I left, in the same stage" shape=doublecircle style=filled fillcolor=lightgreen];

    board_frame_arrived -> own_mr_in_watch_ci;
    own_mr_in_watch_ci -> back_in_stage [label="yes: watch-ci owns this MR's CI; no move"];
    own_mr_in_watch_ci -> frame_kind [label="no"];
    frame_kind -> ci_triage_own [label="own MR: CI failed"];
    frame_kind -> git_rebase_own [label="own MR: needs a rebase"];
    frame_kind -> ci_triage_stacked [label="stacked MR: failing CI"];
    frame_kind -> run_field_set_board_note [label="stacked MR: needs a rebase"];
    frame_kind -> stop_board_handoff [label="tempted to open a gate, reply, or leave it for a doctor"];
    stop_board_handoff -> frame_kind;
    ci_triage_own -> own_real_job;
    own_real_job -> fix_on_my_branch [label="yes"];
    own_real_job -> run_field_set_board_note [label="no: INFRA or INHERITED only"];
    git_rebase_own -> rebase_status;
    rebase_status -> rerun_after_rebase [label="clean"];
    rebase_status -> run_budget_conflicts [label="conflict"];
    rebase_status -> run_stage_fail_board [label="error"];
    run_budget_conflicts -> conflict_rounds_spent;
    conflict_rounds_spent -> resolve_board_conflicts [label="no"];
    conflict_rounds_spent -> git_rebase_abort [label="yes"];
    resolve_board_conflicts -> continue_status;
    continue_status -> run_budget_conflicts [label="another commit conflicted"];
    continue_status -> rerun_after_rebase [label="rebase finished"];
    continue_status -> git_rebase_abort [label="error"];
    git_rebase_abort -> run_stage_fail_board;
    rerun_after_rebase -> rebased_green;
    rebased_green -> back_in_stage [label="yes"];
    rebased_green -> fix_on_my_branch [label="no"];
    ci_triage_stacked -> judge_stacked_cause;
    judge_stacked_cause -> stacked_cause;
    stacked_cause -> fix_on_my_branch [label="yes"];
    stacked_cause -> run_field_set_board_note [label="no, or not provable"];
    fix_on_my_branch -> fix_green;
    fix_green -> back_in_stage [label="yes"];
    fix_green -> run_stage_fail_board [label="no: it needs a call this stage cannot make"];
    run_field_set_board_note -> back_in_stage;
    run_stage_fail_board -> stage_failed;
}
```

### About this run's own MR, with watch-ci the current stage?

Yes only for an own-MR frame (CI failed, or needs a rebase) while
watch-ci is the stage at the position: its `ci_watch` and lease already
own that MR's CI, so the frame changes nothing and you go back to waiting
on it. A stacked-MR frame is never answered here, watch-ci included.

### STOP: the frame is this stage's work; no gate, reply or doctor

The frame is not a question and not a chat message. Never open a gate
for it, `run_stage fail` to hand it on, redirect the run, reply with
`chat_dm`, `rt chat` or SendMessage, or wait for a doctor: the board
launched none because this run owns the MR. Take the frame's own edge.

### Fix it test-first and commit on this run's branch

Read the failed jobs the triage names (`mr_job_trace` for one it marks
UNCLEAR), then a failing test, the fix and a commit in the run's
worktree, as part of the current stage: it is the stage's work, not a
separate loop. Never push: ship pushes the commits with the rest (the
current stage's own record, such as implement's `commits`, picks them
up). Never touch the stacked MR's
branch: its fix, if yours, lands on this branch.

### git_rebase {tree: <worktree>, onto: origin/<the frame's target>}

Commit the stage's in-flight edit first: the rebase needs a clean tree.

### Resolve the files, then continue the board rebase on Bash

Resolve each conflicted file `git_rebase` returned, then continue on Bash
(no tool continues a rebase).

### Rerun the stage's tests on the rebased branch

The tests the current stage has already run this session, on the
rebased branch. The rebase rewrote commits the MR already holds, so
ship's next push takes force-with-lease. Never push here.

### Judge whether this branch's change caused the stacked MR's failure

Compare the triage's blocking jobs and their logs with this branch's
diff against its target. Yes needs a job failing in code this branch
changed; a failure in the stacked MR's own change, or INFRA, is no.

### run_field_set {runDb, key: board-<the frame's iid>, value: <one-line note>, stage}

One line naming the MR and what you found: `!4127 red on pipeline
88120431: INFRA runner timeout, no code change`, `!4131 red on
pipeline 88120577: its own lint job, not this branch`, or for a rebase
frame `!4131 needs a rebase: a doctor rebases it after this run`. Never
rebase, push to or retry the stacked MR: it is someone else's branch.

## What the graph cannot show

- **Entry.** A running run's id goes to `resume`, never `runDb`: only
  resume writes a missing manifest. `spawnedBy` starts fresh, never clarify.
- **Resumed.** The attempt is adopted, so an armed `waiting-gate` on any
  row is reconciled first, and a late (`alreadyReconciled`) answer is still
  acted on. On a failed or done row `run_next` writes nothing and returns
  that gate's inputs. Decided questions stay decided. A `gate_reconcile`
  error reading `no gate <id>` is `not found`; any other error is
  `refused`.
- **One owner for stage rows.** The run tools write them; a stage writes
  its fields and its own `run_stage fail`. Never write stage rows, produce
  clears, `shipTarget` or `pipeline-stages` here.
- **Hand-back.** A stage ending at a Go back hands `{to, note,
  decidedBy}`, and a Fix hands `{to: implement, note, decidedBy}` the same
  way; `attempt` is its running attempt.
- **`repeated: true`**: already applied; follow the result.
- **decidedBy** is the gate tool's returned `decidedBy`, or, for a
  hand-back, the handed `decidedBy` (`pane` when it was typed in the
  pane). The gate tools record each gate's answers; this file records none.
- **A finished run stays finished.** Only Close's Done or Abandon ends it;
  a green `ci` does not. Never carry a finished run's `runDb` into new work;
  a new AFTER on a shipped run is not new work, so it reopens that run.
- **This file's gates** walk gate-protocol's Runs integration with `runDb`
  and `stage`, "Under a run: fail the stage at the gate?" answered no.
- **Account back-fill**: `selection` is the spawn-time pick as an object,
  `decidedBy` the spawning surface.
- **A board frame while a gate waits.** Walk the board frame map, then end
  the turn again the way the gate's site ended it; the gate stays armed.

## Gate questions

Each question is its own; never fold one list into another.

| Gate | Question | Options (recommended first) |
|---|---|---|
| `clarify` | `resume` (write-in) | **Resume it (Recommended)** / **Start fresh** / **Hold** |
| `<stage>-failed:<attempt>` | `action` | **Retry the stage (Recommended)** (when the reason names something fixable) / **Abandon the run** |
| | `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** |
| | `to` | on Go back, with more than one `earlier` stage: one per stage, split `to-1`, `to-2`, ... over 4 |
| `close` | `next` | **Done** (when `ci` is green and the MR ready) / **Iterate here** / **Go back** / **Hold** |
| | `to` | on Go back, with more than one stage: one per `stages` entry, split over 4 |

With one candidate stage, label the option **Go back to `<stage>`** and
skip `to`.

The answer maps to `run_resolve`'s `next`, with their words as `note`.
Read `next` first: Proceed applies `action`, Retry as `retry`, Abandon as
`abandon`. Iterate here is `iterate` (`to` = `implement` at close), Go
back is `redirect` with `to` from `to-*`, Hold is `hold`, Done is `done`.
`attempt` is the failure scope's `<n>`, or at close the last stage's.

## Sub-agent tiering

{{slot:tiering}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
