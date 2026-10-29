---
order: 2
---

# The review graph

```mermaid
flowchart TB
%% name: review
    trigger_review_teammate([Trigger: review a teammate's MR or PR])
    run_enter[/"run_enter {flags, skillDir, stage: review, runDb?, resume?, spawnedBy?}"/]
    run_enter_mode{review run_enter mode?}
    gate_resume_choice
    resume_answer{Review resume answer?}
    run_enter_resume[/"run_enter {flags, skillDir, stage: review, resume: <picked runId>}"/]
    run_enter_fresh[/"run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}"/]
    refused_carried_resume{The refused review run_enter carried resume?}
    stop_no_run_without_enter[STOP: no review run without run_enter; report why to the user]:::stop
    run_snapshot[/"run_snapshot {runDb: <resumed review>}"/]
    snapshot_records{Resumed review snapshot records?}
    resolve_target
    target_form{Review target form?}
    mr_view[/"mr_view {mrUrl, or repoName + iid}"/]
    mr_view_found{mr_view returned the MR?}
    mr_for_branch[/"mr_for_branch {repoName: <checkout>, branches: [<branch>]}"/]
    branch_entry_found{mr_for_branch entry for the branch?}
    gh_pr_view[/gh pr view <ref>/]
    pr_view_found{gh pr view found the PR?}
    mr_list_branch[/"mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}"/]
    branch_matches{mr_list matches for the branch?}
    mr_list_ticket[/"mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}"/]
    ticket_matches{mr_list matches for the ticket?}
    run_budget_target_clarify[/"run_budget {runDb, key: target-clarify, limit: 2, stage}"/]
    target_clarify_spent{target-clarify spent?}
    stop_gitlab_shell_search[STOP: GitLab ticket searches go through the read tools or gitlab_get]:::stop
    stop_gitlab_shell_reads[STOP: GitLab reads go through the read tools or gitlab_get]:::stop
    stop_gitlab_branch_lookup[STOP: GitLab branch lookups go through the read tools or gitlab_get]:::stop
    gate_which_target
    target_answer{Review target answer?}
    own_run_record_target{Own review run: record the target?}
    record_target
    caller_decided_report{Caller handed a decided selection and the report it decided on?}
    caller_framed_rereview{Caller framed a re-review?}
    take_earlier_threads
    threads_in_hand{Earlier threads in hand?}
    print_depth_block
    diff_forge{Review diff forge?}
    gh_pr_diff[/gh pr diff <ref>/]
    git_fetch_pr_head[/git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>/]
    git_fetch_mr_head[/git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>/]
    git_diff[/git diff origin/<targetBranch>...origin/mr-<iid>/]
    head_checkout_in_hand{MR-head checkout in hand?}
    worktree_provision[/"worktree_provision {repoName, branch: <source branch>, reuse: true}"/]
    provision_returned_path{Review head worktree_provision returned a path?}
    tree_at_fetched_head{Provisioned review tree at the fetched head?}
    stop_checkout_without_provision[STOP: create a review checkout only with worktree_provision]:::stop
    set_up_depth
    repro_browser{Review repro takes a browser screenshot?}
    capture_repro
    select_rules
    dispatch_reviewer
    check_verdicts
    verdict_problems{Verdict problems left?}
    run_budget_verdict_rounds[/"run_budget {runDb, key: verdict-rounds:<depth>, limit: 2, stage}"/]
    verdict_rounds_spent{verdict-rounds:<depth> spent?}
    repair_verdicts
    assemble_draft
    fails_to_findings
    verify_blocking
    blocking_verified{Every blocking finding verified?}
    run_budget_verify_rounds[/"run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}"/]
    verify_rounds_spent{verify-rounds:<depth> spent?}
    redispatch_reviewer
    demote_unverified
    report_path_given{Review report path given?}
    write_report
    caller_selection{Caller handed a decided selection?}
    report_json_in_hand{Review report json in hand?}
    write_post_extras
    caller_owns_gates{Caller owns the review gates?}
    json_under_temp_root{Report json under the temp root?}
    copy_json_to_scratch
    gate_open_extras[/"gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}"/]
    sh_review_source[/"sh "${CLAUDE_SKILL_DIR}/scripts/review-source.sh" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json"/]
    review_source_exit{review-source.sh exit 0?}
    gate_open_hand_back[/"gate_open {kind: review-post, sourcePath: <dir>/review-post.source.json, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}"/]
    gate_open_result{gate_open result?}
    stop_only_gate_open[STOP: only gate_open writes the review-post open; never hand-edit or hand-fit it]:::stop
    run_budget_open_fix[/"run_budget {runDb, key: post-open-fix, limit: 2, stage}"/]
    open_fix_spent{post-open-fix spent?}
    fix_named_field
    script_off_answer{Review script off-script answer?}
    write_run_line
    hand_back_severity
    caller_answer{Review caller's answer?}
    gate_post_carry
    gate_post_legacy
    post_next_answer{Review-post next answer?}
    take_human_changes
    iterate_wants_depth{Review iterate note asks for another depth?}
    posting_forge{Review posting forge?}
    gh_pr_review[/gh pr review <ref> with the disposition and the summary body/]
    pr_review_result{gh pr review result?}
    gh_off_answer{gh pr review off-script answer?}
    gh_pr_comment[/gh pr comment <ref> with the summary body/]
    compose_review
    resumed_read_mr_first{Resumed run: read the MR first?}
    mr_posted_since[/"mr_posted_since {mrUrl, since: <run started_at>, items}"/]
    review_already_posted{This review already on the MR?}
    mr_review_submit[/"mr_review_submit {mrUrl, outcome, summary, comments, replies}"/]
    mr_review_submit_result{mr_review_submit result?}
    run_budget_bad_anchors[/"run_budget {runDb, key: bad-anchors, limit: 2, stage}"/]
    bad_anchors_spent{bad-anchors spent?}
    move_bad_anchors
    make_review_move
    make_approve_move
    end_with_link
    gate_off_script_script
    gate_off_script_gh
    stop_split_submit[STOP: post a review only as one mr_review_submit]:::stop
    gate_off_script_submit
    gate_off_script_pending
    submit_off_answer{Review submit off-script answer?}
    mr_approve[/"mr_approve {mrUrl}"/]
    mr_approve_result{mr_approve result?}
    gate_off_script_approve
    approve_off_answer{Approval off-script answer?}
    gate_record[/"gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}"/]
    own_run_close{Own review run: close it?}
    own_run_abandon{Own review run: abandon it?}
    run_close[/"run_close {runDb, workType: review, stage: review, outcome}"/]
    closed_as{Review closed as?}
    run_stage_fail[/"run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}"/]
    run_hold[/"run_hold {runDb, stage, reason, decidedBy}"/]
    held_end_turn(((Review held: end the turn)))
    handed_back_quoted(((Review handed back: the why and what posted, quoted)))
    posted(((Review posted))):::done
    trigger_review_teammate --> run_enter
    run_enter --> run_enter_mode
    run_enter_resume --> run_enter_mode
    run_enter_fresh --> run_enter_mode
    run_enter_mode -->|started, or inherited| resolve_target
    run_enter_mode -->|resumed| run_snapshot
    run_enter_mode -->|candidates| gate_resume_choice
    run_enter_mode -->|refused, or no tool| refused_carried_resume
    refused_carried_resume -->|yes: say so, start fresh| run_enter_fresh
    refused_carried_resume -->|no| stop_no_run_without_enter
    gate_resume_choice --> resume_answer
    resume_answer -->|resume| run_enter_resume
    resume_answer -->|start fresh| run_enter_fresh
    resume_answer -->|hold| held_end_turn
    run_snapshot --> snapshot_records
    snapshot_records -->|no post decision: re-enter, reuse every recorded answer| resolve_target
    snapshot_records -->|a post decision| own_run_close
    resolve_target --> target_form
    target_form -->|GitLab URL or iid| mr_view
    target_form -->|GitLab branch| mr_for_branch
    target_form -->|GitHub| gh_pr_view
    target_form -->|several candidates| gate_which_target
    target_form -->|ticket id only| mr_list_ticket
    target_form -->|tempted to search with the GitLab CLI| stop_gitlab_shell_search
    stop_gitlab_shell_search --> mr_list_ticket
    mr_for_branch --> branch_entry_found
    branch_entry_found -->|an iid| mr_view
    branch_entry_found -->|null: no open MR| mr_list_branch
    branch_entry_found -->|an error: hold, quoting it| run_hold
    branch_entry_found -->|tempted to look it up with the GitLab CLI| stop_gitlab_branch_lookup
    stop_gitlab_branch_lookup --> mr_list_branch
    mr_list_branch --> branch_matches
    branch_matches -->|exactly one| mr_view
    branch_matches -->|none: hold| run_hold
    branch_matches -->|several, or truncated| gate_which_target
    branch_matches -->|an error: hold, quoting it| run_hold
    mr_list_ticket --> ticket_matches
    ticket_matches -->|exactly one, untruncated| mr_view
    ticket_matches -->|none, several, or truncated| gate_which_target
    ticket_matches -->|an error: quoted in the gate| gate_which_target
    mr_view --> mr_view_found
    mr_view_found -->|yes| own_run_record_target
    mr_view_found -->|an error: hold, quoting it| run_hold
    mr_view_found -->|tempted to read it with the GitLab CLI| stop_gitlab_shell_reads
    stop_gitlab_shell_reads --> mr_view
    gh_pr_view --> pr_view_found
    pr_view_found -->|yes| own_run_record_target
    pr_view_found -->|no: hold, quoting it| run_hold
    gate_which_target --> target_answer
    target_answer -->|a target picked| target_form
    target_answer -->|their text| run_budget_target_clarify
    target_answer -->|next: hold| run_hold
    run_budget_target_clarify --> target_clarify_spent
    target_clarify_spent -->|no: resolve it| target_form
    target_clarify_spent -->|yes: hold| run_hold
    own_run_record_target -->|yes| record_target
    own_run_record_target -->|no: inherited| caller_decided_report
    record_target --> caller_decided_report
    caller_decided_report -->|yes: post it; review nothing again| posting_forge
    caller_decided_report -->|yes, but a selected id the json lacks: hold, quoting it| run_hold
    caller_decided_report -->|no| caller_framed_rereview
    caller_framed_rereview -->|yes| take_earlier_threads
    caller_framed_rereview -->|no| print_depth_block
    take_earlier_threads --> threads_in_hand
    threads_in_hand -->|yes, or none to judge| print_depth_block
    threads_in_hand -->|no: the read errored| run_hold
    print_depth_block --> diff_forge
    diff_forge -->|GitHub| gh_pr_diff
    diff_forge -->|GitLab| git_fetch_mr_head
    git_fetch_mr_head --> git_diff
    git_diff --> head_checkout_in_hand
    gh_pr_diff --> git_fetch_pr_head
    git_fetch_pr_head --> head_checkout_in_hand
    head_checkout_in_hand -->|yes, or read depth| set_up_depth
    head_checkout_in_hand -->|no: verify or repro| worktree_provision
    head_checkout_in_hand -->|tempted to create one by hand| stop_checkout_without_provision
    stop_checkout_without_provision --> worktree_provision
    worktree_provision --> provision_returned_path
    provision_returned_path -->|yes| tree_at_fetched_head
    provision_returned_path -->|no: checks not run| select_rules
    tree_at_fetched_head -->|yes| set_up_depth
    tree_at_fetched_head -->|no: checks not run| select_rules
    set_up_depth --> repro_browser
    repro_browser -->|yes| capture_repro
    repro_browser -->|no: read or verify depth, or the domain's own method| select_rules
    capture_repro -->|Board ready or Not drawn| select_rules
    select_rules --> dispatch_reviewer
    dispatch_reviewer --> check_verdicts
    check_verdicts --> verdict_problems
    verdict_problems -->|none, or no selection| assemble_draft
    verdict_problems -->|yes| run_budget_verdict_rounds
    run_budget_verdict_rounds --> verdict_rounds_spent
    verdict_rounds_spent -->|no| repair_verdicts
    repair_verdicts --> check_verdicts
    verdict_rounds_spent -->|yes: unanswered in the Assessment| assemble_draft
    assemble_draft --> fails_to_findings
    fails_to_findings --> verify_blocking
    verify_blocking --> blocking_verified
    blocking_verified -->|yes, or none blocking| report_path_given
    blocking_verified -->|no| run_budget_verify_rounds
    run_budget_verify_rounds --> verify_rounds_spent
    verify_rounds_spent -->|no| redispatch_reviewer
    verify_rounds_spent -->|yes| demote_unverified
    redispatch_reviewer --> assemble_draft
    demote_unverified --> report_path_given
    report_path_given -->|yes| write_report
    report_path_given -->|no| caller_selection
    write_report --> caller_selection
    caller_selection -->|yes: use it, ask nothing| posting_forge
    caller_selection -->|no| report_json_in_hand
    report_json_in_hand -->|yes| write_post_extras
    report_json_in_hand -->|no| gate_post_legacy
    write_post_extras --> caller_owns_gates
    caller_owns_gates -->|yes: a board wrapper said so| sh_review_source
    caller_owns_gates -->|no: direct run| json_under_temp_root
    json_under_temp_root -->|yes| gate_open_extras
    json_under_temp_root -->|no| copy_json_to_scratch
    copy_json_to_scratch --> gate_open_extras
    gate_open_extras --> gate_open_result
    sh_review_source --> review_source_exit
    review_source_exit -->|yes| gate_open_hand_back
    review_source_exit -->|exit 1: names a field| run_budget_open_fix
    review_source_exit -->|exit 2| gate_off_script_script
    gate_open_hand_back --> gate_open_result
    gate_open_result -->|opened| gate_post_carry
    gate_open_result -->|handed back| write_run_line
    gate_open_result -->|refused: names a field| run_budget_open_fix
    gate_open_result -->|refused: no field to fix| gate_off_script_script
    gate_open_result -->|tempted to edit or fit the open by hand| stop_only_gate_open
    stop_only_gate_open --> gate_off_script_script
    run_budget_open_fix --> open_fix_spent
    open_fix_spent -->|no| fix_named_field
    open_fix_spent -->|yes| gate_off_script_script
    fix_named_field --> caller_owns_gates
    gate_off_script_script --> script_off_answer
    script_off_answer -->|take| gate_post_legacy
    script_off_answer -->|iterate here| write_post_extras
    script_off_answer -->|hold| run_hold
    script_off_answer -->|hand back| own_run_abandon
    write_run_line --> hand_back_severity
    hand_back_severity --> caller_answer
    caller_answer -->|"{findings, outcome}"| posting_forge
    caller_answer -->|hold| run_hold
    gate_post_carry --> post_next_answer
    gate_post_legacy --> post_next_answer
    post_next_answer -->|proceed| posting_forge
    post_next_answer -->|iterate here| take_human_changes
    post_next_answer -->|hold| run_hold
    take_human_changes --> iterate_wants_depth
    iterate_wants_depth -->|yes| print_depth_block
    iterate_wants_depth -->|no: a new gate next| report_path_given
    posting_forge -->|GitHub| gh_pr_review
    posting_forge -->|GitLab| compose_review
    gh_pr_review --> pr_review_result
    pr_review_result -->|posted| gate_record
    pr_review_result -->|error| gate_off_script_gh
    gate_off_script_gh --> gh_off_answer
    gh_off_answer -->|take| gh_pr_comment
    gh_off_answer -->|iterate here| gh_pr_review
    gh_off_answer -->|hold| run_hold
    gh_off_answer -->|hand back| own_run_abandon
    gh_pr_comment --> gate_record
    compose_review --> resumed_read_mr_first
    resumed_read_mr_first -->|no: a first pass| mr_review_submit
    resumed_read_mr_first -->|yes: resumed| mr_posted_since
    mr_posted_since --> review_already_posted
    review_already_posted -->|no| mr_review_submit
    review_already_posted -->|yes, approval outstanding| gate_off_script_approve
    review_already_posted -->|yes, nothing outstanding| gate_record
    review_already_posted -->|partly| gate_off_script_submit
    review_already_posted -->|the read errored| run_hold
    mr_review_submit --> mr_review_submit_result
    mr_review_submit_result -->|published, approved as asked| gate_record
    mr_review_submit_result -->|published, approved: false on an approve| gate_off_script_approve
    mr_review_submit_result -->|published: false, bad-anchors| run_budget_bad_anchors
    mr_review_submit_result -->|published: false, pending-drafts| gate_off_script_pending
    mr_review_submit_result -->|error| gate_off_script_submit
    mr_review_submit_result -->|tempted to post pieces with mr_comment_inline, mr_comment, mr_reply_thread, mr_resolve_thread or the GitLab CLI| stop_split_submit
    stop_split_submit --> gate_off_script_submit
    run_budget_bad_anchors --> bad_anchors_spent
    bad_anchors_spent -->|no| move_bad_anchors
    bad_anchors_spent -->|yes| gate_off_script_submit
    move_bad_anchors --> mr_review_submit
    gate_off_script_submit --> submit_off_answer
    gate_off_script_pending --> submit_off_answer
    submit_off_answer -->|take| make_review_move
    submit_off_answer -->|iterate here| mr_review_submit
    submit_off_answer -->|hold| run_hold
    submit_off_answer -->|hand back| own_run_abandon
    make_review_move --> gate_record
    mr_approve --> mr_approve_result
    mr_approve_result -->|approved| gate_record
    mr_approve_result -->|refused| gate_off_script_approve
    gate_off_script_approve --> approve_off_answer
    approve_off_answer -->|take| make_approve_move
    approve_off_answer -->|iterate here| mr_approve
    approve_off_answer -->|hold| run_hold
    approve_off_answer -->|hand back| own_run_abandon
    make_approve_move --> gate_record
    gate_record --> own_run_close
    own_run_close -->|yes: done| run_close
    own_run_close -->|no: inherited| end_with_link
    own_run_abandon -->|yes: abandoned| run_close
    own_run_abandon -->|no: inherited| run_stage_fail
    run_close --> closed_as
    closed_as -->|done| end_with_link
    closed_as -->|abandoned| handed_back_quoted
    end_with_link --> posted
    run_stage_fail --> handed_back_quoted
    run_hold --> held_end_turn
```
