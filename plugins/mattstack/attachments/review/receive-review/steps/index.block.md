---
order: 2
---

# Steps

```mermaid
flowchart TB
%% name: receive_review
    trigger_review_feedback([Trigger: review feedback to answer on your own MR/PR])
    run_enter[/"run_enter {flags, skillDir, stage: receive-review, runDb?, resume?, spawnedBy?}"/]
    run_enter_mode{receive-review run_enter mode?}
    gate_resume_choice
    resume_answer{receive-review clarify answer?}
    run_enter_resume[/"run_enter {flags, skillDir, stage: receive-review, resume: <picked runId>}"/]
    run_enter_fresh[/"run_enter {flags, skillDir, stage: receive-review, fresh: true, spawnedBy?}"/]
    refused_carried_resume{The refused receive-review run_enter carried resume?}
    stop_no_run_without_enter[STOP: no receive-review run without run_enter; report why to the user]:::stop
    run_snapshot[/"run_snapshot {runDb: <resumed receive-review>}"/]
    snapshot_records{What does the receive-review snapshot record?}
    run_field_get_respond_plan[/"run_field_get {runDb, key: extra.gate-source.respond-plan}"/]
    caller_handed{What did the caller hand receive-review?}
    resolve_change
    change_forge{Forge of the change?}
    mr_ref_in_hand{MR url or iid in hand?}
    mr_for_branch[/"mr_for_branch {repoName: <root>, branches: [<branch>]}"/]
    open_mr_found{Open MR with this source branch?}
    report_no_mr
    run_has_mr{The run already records mr?}
    run_field_set_mr[/"run_field_set {runDb, key: mr, value: <MR or PR url>, stage}"/]
    run_has_branch{The run already records branch?}
    run_field_set_branch[/"run_field_set {runDb, key: branch, value: <source branch>, stage}"/]
    executing_handed_plan{"Executing a caller-handed {plan}?"}
    write_pending_source
    handed_threads_where{Where are the handed plan's threads?}
    mr_threads_handed[/"mr_threads {mrUrl} for the handed plan's threads"/]
    read_handed_threads_gh
    keep_plan_threads
    run_field_get_handed[/"run_field_get {runDb, key: extra.gate-source.respond-plan} for the handed plan"/]
    run_stores_source{The run stores a respond-plan source for the handed plan?}
    run_field_get_pending[/"run_field_get {runDb, key: extra.gate-source.respond-plan} for the pending round"/]
    pending_gate_id{The pending round's stored gate id?}
    gate_reconcile_pending[/"gate_reconcile {id: <the stored gate>, runDb, stage}"/]
    pending_reconcile_status{Pending round's gate_reconcile status?}
    thread_read_forge{Forge for the thread read?}
    mr_threads_unresolved[/"mr_threads {mrUrl, filter: "unresolved-human"}"/]
    read_pr_threads_gh
    keep_unresolved_human
    any_unresolved{Any unresolved human threads?}
    select_rules
    dispatch_adjudicator
    draft_verdict_table
    build_plan_open
    caller_owns_plan_gates{Caller owns the receive-review gates at respond-plan?}
    gate_open_plan[/"gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, runDb, stage, scope: respond-plan}"/]
    gate_open_plan_hand_back[/"gate_open {kind: respond-plan, sourcePath: <dir>/respond-plan.source.json, handBack: true, outPath: <dir>/respond-plan.open.json, runDb, stage, scope: respond-plan}"/]
    plan_open_result{respond-plan gate_open result?}
    stop_fit_plan_open[STOP: fit the respond-plan open only with gate_open]:::stop
    run_budget_plan_open[/"run_budget {runDb, key: respond-plan-open, limit: 3, stage}"/]
    plan_open_spent{respond-plan-open spent?}
    fix_plan_source
    gate_off_script_plan_fit
    plan_fit_answer{respond-plan fit answer?}
    write_run_line_plan
    hand_back_verdict_table
    gate_plan_carry
    plan_next_answer{respond-plan pane next answer?}
    redraft_plan_replies
    gate_record_plan[/"gate_record {runDb, stage, scope: respond-plan, shape: respond-plan, gateId | answers + decidedBy, contextDropped?}"/]
    rewrite_report_rows
    code_changes_answer{code-changes answer?}
    next_report_row{Next report row, in verdict-table order?}
    implement_fix
    run_checks
    checks_pass{Fix checks pass?}
    run_budget_fix[/"run_budget {runDb, key: fix:<threadId>, limit: 3, stage}"/]
    fix_spent{fix:<threadId> spent?}
    gate_off_script_fix
    unconverged_fix_answer{Unconverged fix answer?}
    make_unconverged_move
    commit_fix
    redraft_override
    any_thread_offered{"Any thread offered (a finalized fix or an override)?"}
    build_post_open
    caller_owns_post_gates{Caller owns the receive-review gates at respond-post?}
    gate_open_post[/"gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, runDb, stage, scope: respond-post}"/]
    gate_open_post_hand_back[/"gate_open {kind: respond-post, sourcePath: <dir>/respond-post.source.json, handBack: true, outPath: <dir>/respond-post.open.json, runDb, stage, scope: respond-post}"/]
    post_open_result{respond-post gate_open result?}
    stop_fit_post_open[STOP: fit the respond-post open only with gate_open]:::stop
    run_budget_post_open[/"run_budget {runDb, key: respond-post-open, limit: 3, stage}"/]
    post_open_spent{respond-post-open spent?}
    fix_post_source
    gate_off_script_post_fit
    post_fit_answer{respond-post fit answer?}
    write_run_line_post
    hand_back_offered
    gate_post_carry
    post_next_answer{respond-post next answer?}
    decide_nothing
    apply_post_note
    gate_record_post[/"gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy}"/]
    post_forge{Forge for the post side?}
    respond_post_execute[/"respond_post_execute {runDb, tree, stage}"/]
    execute_result{respond_post_execute result?}
    run_budget_execute_fix[/"run_budget {runDb, key: post-execute-fix, limit: 2, stage}"/]
    execute_fix_spent{post-execute-fix spent?}
    fix_execute_refusal
    gate_off_script_execute
    execute_refusal_answer{respond_post_execute refusal answer?}
    stop_shell_push[STOP: respond_post_execute pushes the fix; never push from the shell, never force]:::stop
    stop_post_outside_execute[STOP: post replies only through respond_post_execute]:::stop
    gate_off_script_forge
    forge_refusal_answer{Forge refusal answer?}
    report_held_threads
    run_field_set_hold_clear[/"run_field_set {runDb, key: hold, value: -, stage}"/]
    read_posted_threads_gh
    gh_read_complete{The GitHub read returned every thread due?}
    picks_need_push{Picks post or resolve a gate-1: fix row?}
    git_branch_current[/git branch --show-current/]
    git_rev_parse_push[/"git rev-parse --abbrev-ref @{push}"/]
    branches_match_mr{Both name the MR's source branch?}
    git_push[/"git_push {tree: <worktree root>}"/]
    push_result{git_push result for the fix rows?}
    stop_push_after_failed[STOP: a failed git_push holds the fix rows; never push from the shell, never force]:::stop
    hold_fix_rows
    next_github_thread{Next GitHub thread?}
    post_reply
    resolve_decided{resolve: decided for this thread?}
    resolve_thread
    github_fix_held{Any GitHub fix row held this pass?}
    gate_record_held[/"gate_record {runDb, stage, scope: respond-post, shape: respond-post, gateId | answers + decidedBy, held}"/]
    run_field_set_hold_held[/"run_field_set {runDb, key: hold, value: held, stage: <stage>}"/]
    report_outcome
    verb_owns_run{This verb started or resumed the run?}
    own_run_failed_or_abandoned{Failed or abandoned: is the run this verb's own?}
    run_close[/"run_close {runDb, workType: receive-review, stage: receive-review, outcome}"/]
    closed_as{receive-review closed as?}
    run_stage_fail[/"run_stage {action: fail, stage: <stage>, reason}"/]
    run_hold[/"run_hold {runDb, stage, reason, decidedBy}"/]
    no_open_mr(((No open MR: nothing to answer)))
    held_end_turn(((Held: end the turn naming the run and stage)))
    threads_held_open(((Threads held: run left open for a resume)))
    stage_failed(((receive-review stage failed)))
    feedback_answered(((Review feedback answered))):::done
    trigger_review_feedback --> run_enter
    run_enter --> run_enter_mode
    run_enter_resume --> run_enter_mode
    run_enter_fresh --> run_enter_mode
    run_enter_mode -->|started, or inherited: stage is at.stage| caller_handed
    run_enter_mode -->|resumed| run_snapshot
    run_enter_mode -->|candidates| gate_resume_choice
    run_enter_mode -->|refused, or the tool is missing| refused_carried_resume
    refused_carried_resume -->|yes: say so, start fresh| run_enter_fresh
    refused_carried_resume -->|no| stop_no_run_without_enter
    gate_resume_choice --> resume_answer
    resume_answer -->|resume| run_enter_resume
    resume_answer -->|start fresh| run_enter_fresh
    resume_answer -->|hold: no run yet, record nothing| held_end_turn
    run_snapshot --> snapshot_records
    snapshot_records -->|no respond-plan record| caller_handed
    snapshot_records -->|respond-plan recorded only, nothing handed, no source stored after a revise: never record it again| run_field_get_respond_plan
    snapshot_records -->|respond-plan recorded as code-changes: revise, nothing handed, its source stored after the revise: the round is pending| run_field_get_pending
    snapshot_records -->|"respond-plan recorded as code-changes: revise, a {plan} handed: the newer plan"| caller_handed
    snapshot_records -->|"respond-plan recorded only, a {post} handed"| gate_record_post
    snapshot_records -->|respond-post recorded, held or not| post_forge
    run_field_get_respond_plan -->|the stored cards, or an unset-key error| rewrite_report_rows
    run_field_get_pending --> pending_gate_id
    pending_gate_id -->|null: a hand-back stored it| write_pending_source
    pending_gate_id -->|an id| gate_reconcile_pending
    gate_reconcile_pending --> pending_reconcile_status
    pending_reconcile_status -->|answered: record it with gateId| gate_record_plan
    pending_reconcile_status -->|open, closed or not found| write_pending_source
    write_pending_source --> caller_owns_plan_gates
    caller_handed -->|"nothing, or a {plan} (alone or in {plan, post})"| resolve_change
    caller_handed -->|"a {post} alone"| gate_record_post
    resolve_change --> change_forge
    change_forge -->|GitLab| mr_ref_in_hand
    change_forge -->|GitHub: the PR url| run_has_mr
    mr_ref_in_hand -->|yes| run_has_mr
    mr_ref_in_hand -->|no| mr_for_branch
    mr_for_branch --> open_mr_found
    open_mr_found -->|yes: its iid| run_has_mr
    open_mr_found -->|null entry| report_no_mr
    open_mr_found -->|an error: fail, quoting it| own_run_failed_or_abandoned
    report_no_mr --> no_open_mr
    run_has_mr -->|no| run_field_set_mr
    run_has_mr -->|yes: keep it| run_has_branch
    run_field_set_mr --> run_has_branch
    run_has_branch -->|no| run_field_set_branch
    run_has_branch -->|yes: keep it| executing_handed_plan
    run_field_set_branch --> executing_handed_plan
    executing_handed_plan -->|yes, not yet spent: never re-adjudicate| handed_threads_where
    executing_handed_plan -->|no, or spent by a revise| thread_read_forge
    executing_handed_plan -->|spent: the run records it| run_field_get_respond_plan
    handed_threads_where -->|in this conversation: read nothing| run_field_get_handed
    handed_threads_where -->|not in this conversation: GitLab| mr_threads_handed
    handed_threads_where -->|not in this conversation: GitHub| read_handed_threads_gh
    mr_threads_handed -->|threads, resolved ones included| keep_plan_threads
    mr_threads_handed -->|an error: fail, quoting it| own_run_failed_or_abandoned
    read_handed_threads_gh --> keep_plan_threads
    keep_plan_threads --> run_field_get_handed
    run_field_get_handed --> run_stores_source
    run_stores_source -->|yes: record it| gate_record_plan
    run_stores_source -->|no: build it from the handed --report| build_plan_open
    thread_read_forge -->|GitLab| mr_threads_unresolved
    thread_read_forge -->|GitHub| read_pr_threads_gh
    mr_threads_unresolved -->|threads: already filtered| any_unresolved
    mr_threads_unresolved -->|an error: fail, quoting it| own_run_failed_or_abandoned
    read_pr_threads_gh --> keep_unresolved_human
    keep_unresolved_human --> any_unresolved
    any_unresolved -->|yes| select_rules
    select_rules --> dispatch_adjudicator
    any_unresolved -->|none: say so| report_outcome
    dispatch_adjudicator --> draft_verdict_table
    draft_verdict_table --> build_plan_open
    build_plan_open --> caller_owns_plan_gates
    caller_owns_plan_gates -->|yes, no unspent plan handed: a board wrapper said so| gate_open_plan_hand_back
    caller_owns_plan_gates -->|no: a direct run| gate_open_plan
    caller_owns_plan_gates -->|an unspent handed plan: store its source| gate_open_plan_hand_back
    gate_open_plan --> plan_open_result
    gate_open_plan_hand_back --> plan_open_result
    plan_open_result -->|opened: the direct run| gate_plan_carry
    plan_open_result -->|handed back, no unspent plan| write_run_line_plan
    plan_open_result -->|handed back, an unspent handed plan: record it| gate_record_plan
    plan_open_result -->|refused: a line names a source field| run_budget_plan_open
    plan_open_result -->|refused: nothing a source fix can mend| gate_off_script_plan_fit
    plan_open_result -->|tempted to edit the open by hand, shorten a reply, or fit it with a script| stop_fit_plan_open
    stop_fit_plan_open --> gate_off_script_plan_fit
    run_budget_plan_open --> plan_open_spent
    plan_open_spent -->|no| fix_plan_source
    plan_open_spent -->|yes| gate_off_script_plan_fit
    fix_plan_source --> caller_owns_plan_gates
    gate_off_script_plan_fit --> plan_fit_answer
    plan_fit_answer -->|take: the proposed change, once| fix_plan_source
    plan_fit_answer -->|iterate: fix again with their note| fix_plan_source
    plan_fit_answer -->|hold| run_hold
    plan_fit_answer -->|hand back| own_run_failed_or_abandoned
    write_run_line_plan --> hand_back_verdict_table
    hand_back_verdict_table -->|"caller hands {plan} back: answers + decidedBy"| gate_record_plan
    gate_plan_carry --> plan_next_answer
    plan_next_answer -->|continue, or answered off the pane: gateId| gate_record_plan
    plan_next_answer -->|iterate here: answer nothing, record nothing| redraft_plan_replies
    plan_next_answer -->|hold: answer nothing, the gate stays open| run_hold
    redraft_plan_replies -->|a new gate| build_plan_open
    gate_record_plan -->|its rows| rewrite_report_rows
    rewrite_report_rows --> code_changes_answer
    code_changes_answer -->|approve, or skip| next_report_row
    code_changes_answer -->|revise: a fresh dispatch; a handed plan is spent| select_rules
    next_report_row -->|fix, code-changes approve, not yet on the branch| implement_fix
    next_report_row -->|fix already committed on the branch| commit_fix
    next_report_row -->|override| redraft_override
    next_report_row -->|reply, skip, or fix under code-changes skip| next_report_row
    next_report_row -->|rows done| any_thread_offered
    implement_fix --> run_checks
    run_checks --> checks_pass
    checks_pass -->|yes| commit_fix
    checks_pass -->|no: charge the failed attempt| run_budget_fix
    run_budget_fix --> fix_spent
    fix_spent -->|no: another attempt| implement_fix
    fix_spent -->|yes| gate_off_script_fix
    gate_off_script_fix --> unconverged_fix_answer
    unconverged_fix_answer -->|take| make_unconverged_move
    unconverged_fix_answer -->|iterate: try again with their note| implement_fix
    unconverged_fix_answer -->|hold| run_hold
    unconverged_fix_answer -->|hand back| own_run_failed_or_abandoned
    make_unconverged_move --> next_report_row
    commit_fix --> next_report_row
    redraft_override --> next_report_row
    any_thread_offered -->|no: no respond-post gate, no record| post_forge
    any_thread_offered -->|yes| build_post_open
    build_post_open --> caller_owns_post_gates
    caller_owns_post_gates -->|yes, no post handed yet: a board wrapper said so| gate_open_post_hand_back
    caller_owns_post_gates -->|no: a direct run| gate_open_post
    caller_owns_post_gates -->|post already handed: store its source| gate_open_post_hand_back
    gate_open_post --> post_open_result
    gate_open_post_hand_back --> post_open_result
    post_open_result -->|opened: the direct run| gate_post_carry
    post_open_result -->|handed back, no post handed yet| write_run_line_post
    post_open_result -->|handed back, post already handed: record it| gate_record_post
    post_open_result -->|refused: a line names a source field| run_budget_post_open
    post_open_result -->|refused: nothing a source fix can mend| gate_off_script_post_fit
    post_open_result -->|tempted to edit the open by hand, shorten a reply, or fit it with a script| stop_fit_post_open
    stop_fit_post_open --> gate_off_script_post_fit
    run_budget_post_open --> post_open_spent
    post_open_spent -->|no| fix_post_source
    post_open_spent -->|yes| gate_off_script_post_fit
    fix_post_source --> caller_owns_post_gates
    gate_off_script_post_fit --> post_fit_answer
    post_fit_answer -->|take: the proposed change, once| fix_post_source
    post_fit_answer -->|iterate: fix again with their note| fix_post_source
    post_fit_answer -->|hold| run_hold
    post_fit_answer -->|hand back| own_run_failed_or_abandoned
    write_run_line_post --> hand_back_offered
    hand_back_offered -->|"caller hands {post} back: answers + decidedBy"| gate_record_post
    gate_post_carry --> post_next_answer
    post_next_answer -->|proceed, in the pane or off it: gateId| gate_record_post
    post_next_answer -->|"hold: answer the gate (next: hold), record nothing"| decide_nothing
    post_next_answer -->|"iterate: answer the gate (next: iterate), record nothing"| apply_post_note
    decide_nothing --> run_hold
    apply_post_note -->|a new gate| build_post_open
    gate_record_post --> post_forge
    post_forge -->|GitLab| respond_post_execute
    post_forge -->|GitHub: never respond_post_execute or an mr_ tool| read_posted_threads_gh
    respond_post_execute --> execute_result
    execute_result -->|held is empty| run_field_set_hold_clear
    execute_result -->|a reply or resolve held| gate_off_script_forge
    execute_result -->|only push, mismatch or read held| report_held_threads
    execute_result -->|refused: a line names a field, a record or the tree| run_budget_execute_fix
    execute_result -->|refused: nothing a fix on this run can mend| gate_off_script_execute
    execute_result -->|tempted to push from the shell or force| stop_shell_push
    execute_result -->|tempted to reply or resolve by hand| stop_post_outside_execute
    stop_shell_push --> report_held_threads
    stop_post_outside_execute --> gate_off_script_forge
    run_budget_execute_fix --> execute_fix_spent
    execute_fix_spent -->|no| fix_execute_refusal
    execute_fix_spent -->|yes| gate_off_script_execute
    fix_execute_refusal --> respond_post_execute
    gate_off_script_execute --> execute_refusal_answer
    execute_refusal_answer -->|take: the proposed move, once| fix_execute_refusal
    execute_refusal_answer -->|iterate: fix again with their note| fix_execute_refusal
    execute_refusal_answer -->|hold| run_hold
    execute_refusal_answer -->|hand back| own_run_failed_or_abandoned
    gate_off_script_forge --> forge_refusal_answer
    forge_refusal_answer -->|take: the human posted or resolved by hand| respond_post_execute
    forge_refusal_answer -->|iterate: the cause is fixed| respond_post_execute
    forge_refusal_answer -->|hold: the tool already set hold| report_held_threads
    forge_refusal_answer -->|hand back| own_run_failed_or_abandoned
    report_held_threads --> threads_held_open
    run_field_set_hold_clear --> report_outcome
    read_posted_threads_gh --> gh_read_complete
    gh_read_complete -->|yes| picks_need_push
    gh_read_complete -->|no, or an error: report it verbatim| run_field_set_hold_held
    picks_need_push -->|yes| git_branch_current
    picks_need_push -->|no: push nothing| next_github_thread
    git_branch_current --> git_rev_parse_push
    git_rev_parse_push --> branches_match_mr
    branches_match_mr -->|yes| git_push
    branches_match_mr -->|no, or an error| hold_fix_rows
    git_push --> push_result
    push_result -->|pushed| next_github_thread
    push_result -->|any error| hold_fix_rows
    push_result -->|tempted to push from the shell or force| stop_push_after_failed
    stop_push_after_failed --> hold_fix_rows
    hold_fix_rows -->|every other reply still acts| next_github_thread
    next_github_thread -->|"post: due (picked, or a gate-1: reply row), not held this pass, and the thread lacks this run's reply"| post_reply
    next_github_thread -->|no post due: not picked, held this pass, or already there| resolve_decided
    next_github_thread -->|threads done| github_fix_held
    post_reply --> resolve_decided
    resolve_decided -->|yes, not held this pass| resolve_thread
    resolve_decided -->|no, or held this pass| next_github_thread
    resolve_thread --> next_github_thread
    github_fix_held -->|yes| gate_record_held
    github_fix_held -->|no| report_outcome
    gate_record_held --> run_field_set_hold_held
    report_outcome --> verb_owns_run
    verb_owns_run -->|yes: outcome done| run_close
    verb_owns_run -->|no: inherited, the caller closes| feedback_answered
    own_run_failed_or_abandoned -->|yes: close it failed or abandoned, with the reason| run_close
    own_run_failed_or_abandoned -->|no: inherited, the caller decides| run_stage_fail
    run_close --> closed_as
    closed_as -->|done| feedback_answered
    closed_as -->|failed or abandoned| stage_failed
    run_stage_fail --> stage_failed
    run_hold --> held_end_turn
    run_field_set_hold_held --> threads_held_open
```
