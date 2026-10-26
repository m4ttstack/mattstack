---
order: 2
---

# A board frame mid-run

The board rings this session instead of launching a doctor while the run
is live. The frame arrives as a `<cross-session-message
from-name="board">` naming an MR by `!<iid>`: this run's own MR (`CI
failed on !<iid>`, `!<iid> needs a rebase onto <target>`) or one stacked
on this branch (`!<iid> (stacked on your branch) ...`). Walk this map,
then carry on from where you left off.

```mermaid
flowchart TB
%% name: board_frame
    board_frame_arrived([Trigger: a frame from board arrives mid-run])
    run_position{Where is the run?}
    own_mr_frame{About this run's own MR?}
    frame_kind{Which frame?}
    stop_board_handoff:::stop
    ci_triage_own[/"ci_triage {repoName: <worktree>, iid: <the frame's iid>, pipelineId?: <the frame's pipeline>}"/]
    own_real_job{A REAL job failing on this run's MR?}
    fix_on_my_branch
    git_rebase_own[/"git_rebase {tree: <worktree>, onto: origin/<the frame's target>}"/]
    rebase_status{Board rebase status?}
    run_budget_conflicts[/"run_budget {runDb, key: board:conflict-rounds, limit: 4, stage}"/]
    conflict_rounds_spent{Board conflict-rounds spent?}
    resolve_board_conflicts
    continue_status{Board rebase continue result?}
    git_rebase_abort[/"git_rebase {tree: <worktree>, abort: true}"/]
    rerun_after_rebase
    rebased_green{Green on the rebased branch?}
    ci_triage_stacked[/"ci_triage {repoName: <worktree>, iid: <the stacked iid>, pipelineId?: <the frame's pipeline>}"/]
    judge_stacked_cause
    stacked_cause{This branch's change caused it?}
    stacked_after_ship{"Ship already pushed this attempt (position is watch-ci)?"}
    fix_green{Fixed, with the stage's tests green?}
    git_log_board_shas[/"git log --format=%h <branch-point>..HEAD (after the board move)"/]
    run_field_set_board_commits[/"run_field_set {runDb, key: commits, value: <all shas>, stage}"/]
    gate_armed{"A gate armed in this stage (waiting-gate set)?"}
    run_field_set_board_note[/"run_field_set {runDb, key: board-<the frame's iid>, value: <one-line note>, stage}"/]
    run_stage_fail_board[/"run_stage {runDb, action: fail, stage: <current stage>, reason}"/]
    stage_failed(((The stage ended failed; run_next routes it)))
    back_where_left(((Back where I left off))):::done
    board_frame_arrived --> run_position
    run_position -->|watch-ci running, its lease held| own_mr_frame
    run_position -->|waiting at the close gate: watch-ci finished| run_field_set_board_note
    run_position -->|any other stage| frame_kind
    own_mr_frame -->|yes: watch-ci's ci_watch owns this MR's CI; no move| back_where_left
    own_mr_frame -->|no: a stacked MR| frame_kind
    frame_kind -->|own MR: CI failed| ci_triage_own
    frame_kind -->|own MR: needs a rebase| git_rebase_own
    frame_kind -->|stacked MR: failing CI| ci_triage_stacked
    frame_kind -->|stacked MR: needs a rebase| run_field_set_board_note
    frame_kind -->|tempted to open a gate, reply, or leave it for a doctor| stop_board_handoff
    stop_board_handoff --> frame_kind
    ci_triage_own --> own_real_job
    own_real_job -->|yes| fix_on_my_branch
    own_real_job -->|no: INFRA or INHERITED only, or ci_triage errored| run_field_set_board_note
    git_rebase_own --> rebase_status
    rebase_status -->|clean| rerun_after_rebase
    rebase_status -->|conflict| run_budget_conflicts
    rebase_status -->|error| gate_armed
    run_budget_conflicts --> conflict_rounds_spent
    conflict_rounds_spent -->|no| resolve_board_conflicts
    conflict_rounds_spent -->|yes| git_rebase_abort
    resolve_board_conflicts --> continue_status
    continue_status -->|another commit conflicted| run_budget_conflicts
    continue_status -->|rebase finished| rerun_after_rebase
    continue_status -->|error| git_rebase_abort
    git_rebase_abort --> gate_armed
    rerun_after_rebase --> rebased_green
    rebased_green -->|yes| git_log_board_shas
    rebased_green -->|no| fix_on_my_branch
    ci_triage_stacked --> judge_stacked_cause
    judge_stacked_cause --> stacked_cause
    stacked_cause -->|yes| stacked_after_ship
    stacked_after_ship -->|no| fix_on_my_branch
    stacked_after_ship -->|yes: note it, no local commit| run_field_set_board_note
    stacked_cause -->|no, not provable, or ci_triage errored| run_field_set_board_note
    fix_on_my_branch --> fix_green
    fix_green -->|yes| git_log_board_shas
    fix_green -->|no: it needs a call this stage cannot make| gate_armed
    git_log_board_shas --> run_field_set_board_commits
    run_field_set_board_commits --> back_where_left
    gate_armed -->|yes: the armed gate's answer decides| run_field_set_board_note
    gate_armed -->|no| run_stage_fail_board
    run_field_set_board_note --> back_where_left
    run_stage_fail_board --> stage_failed
```
