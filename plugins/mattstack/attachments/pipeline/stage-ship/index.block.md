---
name: stage-ship
description: "Pipeline stage: publish the unit of work for review -- push, open the MR/PR, attach evidence. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "ship"
  stage-consumes: "commits ticket"
  stage-produces: "mr"
replaced-slots: [domain]
---

# stage: ship

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Write `mr` the moment it exists and
`pushed` once the push lands; fail with `run_stage {action: fail}` naming
what failed. Every `stage` argument is `"ship"`. `<root>` is the absolute worktree root
`git rev-parse --show-toplevel` prints.

```mermaid
flowchart TB
%% name: ship
    ship_entered([Ship stage entered])
    run_field_get_mr[/"run_field_get {key: mr}"/]
    recapture_asked{Reopened to re-capture the AFTER on a shipped run?}
    git_status_recapture[/"git status --porcelain; git log --oneline @{upstream}.. (re-capture)"/]
    nothing_to_push{"Nothing to push (re-capture)?"}
    domain_steps_before_gate
    git_status_log[/"git status --porcelain; git log --oneline @{upstream}.. or -5"/]
    branch_stack[/"branch_stack {tree: <root>}"/]
    stack_parent_read{Stack parent read?}
    run_field_get_target[/"run_field_get {key: shipTarget}"/]
    target_matches_fresh{shipTarget matches the fresh target?}
    gate_ship
    run_field_set_target[/"run_field_set {key: shipTarget, value: <resolved target>, stage}"/]
    run_field_set_target_iterate[/"run_field_set {key: shipTarget, value: -, stage} (iterate)"/]
    run_field_set_target_hold[/"run_field_set {key: shipTarget, value: -, stage} (hold)"/]
    run_budget_gate_rounds[/"run_budget {key: ship:ship-gate-rounds, limit: 2, stage}"/]
    gate_rounds_spent{ship-gate-rounds spent?}
    run_budget_gate_reopenings[/"run_budget {key: ship:ship-gate-reopenings, limit: 2, stage}"/]
    gate_reopenings_spent{ship-gate-reopenings spent?}
    rebase_in_progress{Rebase in progress?}
    git_rebase_abort[/"git_rebase {tree: <root>, abort: true}"/]
    which_exit{Which exit?}
    dirty_answer{dirty answer?}
    commit_named_files[Commit named files, ticket-prefixed subject]
    stash_them
    domain_fast_checks
    checks_pass{Checks pass?}
    run_budget_fix_rounds[/"run_budget {key: ship:fix-rounds, limit: 4, stage}"/]
    fix_rounds_spent{fix-rounds spent?}
    fix_test_first
    domain_rebases_unfinished{Domain rebases, and no rebase finished this pass?}
    git_rebase_onto[/"git_rebase {tree: <root>, onto: origin/<resolved target>}"/]
    rebase_status{Rebase status?}
    run_budget_conflict_rounds[/"run_budget {key: ship:conflict-rounds, limit: 4, stage}"/]
    conflict_rounds_spent{conflict-rounds spent?}
    resolve_conflict_files
    continue_result{Continue result?}
    needs_force_lease{Push needs force-with-lease?}
    git_push_upstream[/"git_push {tree: <root>, setUpstream: true, leaseMrUrl?: <mr>}"/]
    git_push_lease[/"git_push {tree: <root>, forceWithLease: true, leaseMrUrl?: <mr>}"/]
    git_push_result{git_push result?}
    run_field_set_pushed[/"run_field_set {key: pushed, value: <{"sha", "priorPipelineId"} JSON>, stage}"/]
    stop_shell_push[STOP: push only with git_push]:::stop
    stop_lease_holder_owns[STOP: the lease holder owns every commit, push and retry]:::stop
    stand_down(((Stand down: report the holder and stop)))
    gate_push_refused
    make_recorded_move
    push_landed{Push landed?}
    run_budget_landing_checks[/"run_budget {key: ship:landing-checks, limit: 2, stage}"/]
    landing_checks_spent{landing-checks spent?}
    run_field_set_pushed_head[/"run_field_set {key: pushed, value: <{"sha": HEAD, "priorPipelineId": null} JSON>, stage}"/]
    git_remote_origin[/git remote get-url origin/]
    forge_host{Forge host?}
    run_budget_forge_clarify[/"run_budget {key: ship:forge-clarify-rounds, limit: 2, stage}"/]
    forge_clarify_rounds{forge-clarify-rounds spent?}
    gate_which_forge
    mr_create[/"mr_create {repoName: <root>, sourceBranch, targetBranch: <resolved target>, title, description, draft, squash?, labels?, ifExists: return}"/]
    mr_create_result{mr_create result?}
    run_budget_mr_recalls[/"run_budget {key: ship:mr-create-recalls, limit: 2, stage}"/]
    mr_create_recalls{mr-create-recalls spent?}
    mr_update_squash[/"mr_update {mrUrl, squash: true}"/]
    stop_gitlab_shortcut[STOP: GitLab goes through gitlab_get, the read tools and mr_*]:::stop
    gh_pr_create[/"gh pr create --base <resolved target> [--draft]"/]
    gh_create_result{gh pr create result?}
    run_field_set_mr[/"run_field_set {key: mr, value: <url>, stage}"/]
    run_field_get_evidence[/"run_field_get {key: evidence}"/]
    browser_case{Browser screenshot for this case?}
    capture_after_browser
    capture_after_case
    after_result{AFTER result?}
    run_budget_after_attempts[/"run_budget {key: ship:after-attempts:<case id>, limit: 3, stage}"/]
    after_attempts_spent{after-attempts spent?}
    every_case_tried{Every named case tried?}
    after_captured{AFTER captured this pass?}
    record_evidence
    record_outcome{Record outcome?}
    run_has_evidence{Run has an evidence record?}
    attach_evidence
    attach_outcome{Attach outcome?}
    read_forge_host{"Forge host (read back)?"}
    mr_view_url[/"mr_view {mrUrl}"/]
    gh_pr_view_body[/gh pr view <mr> --json title,body/]
    write_title_description
    write_forge_host{"Forge host (write back)?"}
    mr_update_description[/"mr_update {mrUrl, title, description}"/]
    gh_pr_edit[/gh pr edit <mr> --title <title> --body <description>/]
    run_stage_fail[/"run_stage {action: fail, stage, reason}"/]
    run_hold[/"run_hold {stage, reason, decidedBy}"/]
    held_end_turn(((Held: end the turn naming run and stage)))
    hand_back_go_back(((Hand the Go back answer to the orchestrator)))
    stage_failed(((Stage failed)))
    ship_done(((Ship done: return to the orchestrator))):::done
    ship_entered --> run_field_get_mr
    run_field_get_mr --> recapture_asked
    recapture_asked -->|no| domain_steps_before_gate
    recapture_asked -->|yes: mr is set| git_status_recapture
    git_status_recapture --> nothing_to_push
    nothing_to_push -->|yes: no push, no mr_create| run_field_get_evidence
    nothing_to_push -->|no: ship the new commits first| domain_steps_before_gate
    domain_steps_before_gate --> git_status_log
    git_status_log --> branch_stack
    branch_stack --> stack_parent_read
    stack_parent_read -->|yes: the stack parent| run_field_get_target
    stack_parent_read -->|"no: the default branch (an unreadable store or error says so)"| run_field_get_target
    run_field_get_target --> target_matches_fresh
    target_matches_fresh -->|yes: the earlier Proceed stands| dirty_answer
    target_matches_fresh -->|no| gate_ship
    gate_ship -->|proceed| run_field_set_target
    gate_ship -->|iterate| run_field_set_target_iterate
    gate_ship -->|hold| run_field_set_target_hold
    gate_ship -->|go back, or dirty = abort| rebase_in_progress
    run_field_set_target --> dirty_answer
    run_field_set_target_iterate --> run_budget_gate_rounds
    run_budget_gate_rounds --> gate_rounds_spent
    gate_rounds_spent -->|no: redo with their note| domain_steps_before_gate
    gate_rounds_spent -->|yes: a failure| rebase_in_progress
    run_field_set_target_hold --> run_hold
    rebase_in_progress -->|yes| git_rebase_abort
    rebase_in_progress -->|no| which_exit
    git_rebase_abort --> which_exit
    which_exit -->|go back| hand_back_go_back
    which_exit -->|a failure, abort or hand back| run_stage_fail
    dirty_answer -->|commit| commit_named_files
    dirty_answer -->|stash| stash_them
    dirty_answer -->|clean tree| domain_fast_checks
    commit_named_files --> domain_fast_checks
    stash_them --> domain_fast_checks
    domain_fast_checks --> checks_pass
    checks_pass -->|yes| domain_rebases_unfinished
    checks_pass -->|no| run_budget_fix_rounds
    run_budget_fix_rounds --> fix_rounds_spent
    fix_rounds_spent -->|no| fix_test_first
    fix_rounds_spent -->|yes: reopen| run_budget_gate_reopenings
    fix_test_first --> domain_fast_checks
    domain_rebases_unfinished -->|yes| git_rebase_onto
    domain_rebases_unfinished -->|no| needs_force_lease
    git_rebase_onto --> rebase_status
    rebase_status -->|clean| domain_fast_checks
    rebase_status -->|conflict| run_budget_conflict_rounds
    rebase_status -->|error: a failure| which_exit
    run_budget_conflict_rounds --> conflict_rounds_spent
    conflict_rounds_spent -->|no| resolve_conflict_files
    conflict_rounds_spent -->|yes: reopen| run_budget_gate_reopenings
    run_budget_gate_reopenings --> gate_reopenings_spent
    gate_reopenings_spent -->|no: reopen with what was quoted| gate_ship
    gate_reopenings_spent -->|yes: a failure| rebase_in_progress
    resolve_conflict_files --> continue_result
    continue_result -->|another commit conflicted| run_budget_conflict_rounds
    continue_result -->|rebase finished| domain_fast_checks
    continue_result -->|error: a failure| git_rebase_abort
    needs_force_lease -->|no| git_push_upstream
    needs_force_lease -->|yes| git_push_lease
    git_push_upstream --> git_push_result
    git_push_lease --> git_push_result
    git_push_result -->|ok| run_field_set_pushed
    git_push_result -->|refused: lease_held, holder named| stop_lease_holder_owns
    git_push_result -->|any other error or refusal| stop_shell_push
    stop_lease_holder_owns --> stand_down
    run_field_set_pushed --> git_remote_origin
    stop_shell_push --> gate_push_refused
    gate_push_refused -->|take| make_recorded_move
    gate_push_refused -->|iterate: push again| needs_force_lease
    gate_push_refused -->|hand back| which_exit
    gate_push_refused -->|hold| run_hold
    make_recorded_move --> push_landed
    push_landed -->|yes| run_field_set_pushed_head
    push_landed -->|no| run_budget_landing_checks
    run_budget_landing_checks --> landing_checks_spent
    landing_checks_spent -->|no: reopen with the comparison| gate_push_refused
    landing_checks_spent -->|yes: a failure| which_exit
    run_field_set_pushed_head --> git_remote_origin
    git_remote_origin --> forge_host
    forge_host -->|GitLab| mr_create
    forge_host -->|GitHub| gh_pr_create
    forge_host -->|anything else| run_budget_forge_clarify
    run_budget_forge_clarify --> forge_clarify_rounds
    forge_clarify_rounds -->|no| gate_which_forge
    forge_clarify_rounds -->|yes: a failure| which_exit
    gate_which_forge -->|GitLab or GitHub| forge_host
    gate_which_forge -->|hold| run_hold
    gate_which_forge -->|hand back| which_exit
    mr_create --> mr_create_result
    mr_create_result -->|created| run_field_set_mr
    mr_create_result -->|existing: keep its url; no squash or labels| run_field_set_mr
    mr_create_result -->|squashApplied: false| mr_update_squash
    mr_create_result -->|url: null| run_budget_mr_recalls
    mr_create_result -->|error: a failure| which_exit
    mr_create_result -->|tempted to use the GitLab CLI| stop_gitlab_shortcut
    stop_gitlab_shortcut --> mr_create
    run_budget_mr_recalls --> mr_create_recalls
    mr_create_recalls -->|no: call again| mr_create
    mr_create_recalls -->|yes: a failure| which_exit
    mr_update_squash --> run_field_set_mr
    gh_pr_create --> gh_create_result
    gh_create_result -->|url printed, or already exists| run_field_set_mr
    gh_create_result -->|error: a failure| which_exit
    run_field_set_mr --> run_field_get_evidence
    run_field_get_evidence --> browser_case
    browser_case -->|yes| capture_after_browser
    browser_case -->|no: the domain's own method, or no case named| capture_after_case
    capture_after_browser --> after_result
    capture_after_case --> after_result
    after_result -->|captured, or Board ready| every_case_tried
    after_result -->|none named| after_captured
    after_result -->|skipped: unbound, not a browser case| every_case_tried
    after_result -->|the capture failed, or Not drawn: a failed brief or spent re-renders| run_budget_after_attempts
    after_result -->|Not drawn, a reason no retry fixes: go on without it| every_case_tried
    after_result -->|Held at evidence-redaction| run_hold
    run_budget_after_attempts --> after_attempts_spent
    after_attempts_spent -->|no: same case again| browser_case
    after_attempts_spent -->|yes: go on without it| every_case_tried
    every_case_tried -->|no| browser_case
    every_case_tried -->|yes| after_captured
    after_captured -->|yes| record_evidence
    after_captured -->|no| run_has_evidence
    record_evidence --> record_outcome
    record_outcome -->|Recorded| attach_evidence
    record_outcome -->|Record held at evidence-waiver or evidence-redaction| run_hold
    record_outcome -->|Record failed: a failure naming the images or quoting the error| which_exit
    run_has_evidence -->|yes| attach_evidence
    run_has_evidence -->|no: the field is unset| read_forge_host
    attach_evidence --> attach_outcome
    attach_outcome -->|"Attached (never Taken: Take links)"| read_forge_host
    attach_outcome -->|Attach held| run_hold
    attach_outcome -->|Attach failed: a failure quoting the reason| which_exit
    read_forge_host -->|GitLab| mr_view_url
    read_forge_host -->|GitHub| gh_pr_view_body
    mr_view_url --> write_title_description
    gh_pr_view_body --> write_title_description
    write_title_description --> write_forge_host
    write_forge_host -->|GitLab| mr_update_description
    write_forge_host -->|GitHub| gh_pr_edit
    mr_update_description --> ship_done
    gh_pr_edit --> ship_done
    run_stage_fail --> stage_failed
    run_hold --> held_end_turn
```
