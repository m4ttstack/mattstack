---
name: review
disable-model-invocation: true
description: "Use when reviewing someone else's MR or PR before it merges -- a pasted MR/PR link or !iid, 'review this MR', 'check my co-worker's change', 'is this MR solid'. For your own uncommitted work use self-review; for feedback on your own MR use receive-review."
type: pipeline-step
slots:
  criteria: { contract: review-criteria@1, required: false }
  reviewer: { contract: reviewer-dispatch@1, required: false }
---

# review

The standalone entry for reviewing someone else's change. Follow the
graph's edges; a move it does not show is a question for a gate, never a
judgment call. Reads through the read tools and `gitlab_get` are part of
the step that needs them.

## Run

Outside a pipeline this verb is its own run, so the console shows it and
the Stop hook covers its pane. `run_enter` starts, resumes or inherits the
run, or returns the running candidates; never list, read or build run dbs
by hand. It takes `flags` (the block below, verbatim), `skillDir` (this
skill's directory), `stage: review`, and only when they apply: `runDb` a
caller handed you; `spawnedBy` when a surface launched this pane; `resume`,
a review run id the caller or developer names, or the one on a handed
`--report`'s `review-run: <run id>` line (even in a launched pane).

{{run-start.flags:review}}

Pass the returned `runDb` to every `run_*` and gate call. Your stage is
`review`, except on an inherited run (`mode: inherited`): there it is
`at.stage`, written `<run.current_stage>` in the graph, and the caller
closes the run. A handed `runDb` whose run is not running is not inherited
(`handedRunDb: "not-running"`).

Every gate runs through gate-protocol with `runDb` and `stage`; the gate
tools write the gate fields and record the clarify and off-script answers.
The posting gate records nothing until `gate_record`, after posting. Draw
no `run_field_set {key: gate}` bracket and no `run_decision` gate line.

Each loop counter is one `run_budget {runDb, key, limit, stage}` call on
the counted event; its `<key> spent?` diamond reads `exhausted`. After a
compaction or resume, read a counter you cannot remember with
`increment: 0`; never charge one event twice.

| Key | Limit | Charged when |
|---|---|---|
| `target-clarify` | 2 | the target clarify gate returns typed text |
| `verify-rounds:<depth>` | 2 | a verify round at that depth leaves a blocking finding unverified |
| `post-open-fix` | 2 | a posting-gate refusal names a field (the first charge fixes it) |
| `bad-anchors` | 2 | the submit answers bad-anchors (the first charge moves them) |

{{include:run-identity}}

## The review graph

```dot
digraph review {
    rankdir=TB;

    trigger_review_teammate [label="Trigger: review a teammate's MR or PR" shape=ellipse];
    run_enter [label="run_enter {flags, skillDir, stage: review, runDb?, resume?, spawnedBy?}" shape=plaintext];
    run_enter_mode [label="review run_enter mode?" shape=diamond];
    gate_resume_choice [label="Gate review clarify: Resume / Start fresh / Hold" shape=box];
    resume_answer [label="Review resume answer?" shape=diamond];
    run_enter_resume [label="run_enter {flags, skillDir, stage: review, resume: <picked runId>}" shape=plaintext];
    run_enter_fresh [label="run_enter {flags, skillDir, stage: review, fresh: true, spawnedBy?}" shape=plaintext];
    refused_carried_resume [label="The refused review run_enter carried resume?" shape=diamond];
    stop_no_run_without_enter [label="STOP: no review run without run_enter; report why to the user" shape=octagon style=filled fillcolor=red fontcolor=white];
    run_snapshot [label="run_snapshot {runDb: <resumed review>}" shape=plaintext];
    snapshot_records [label="Resumed review snapshot records?" shape=diamond];

    resolve_target [label="Resolve the review target" shape=box];
    target_form [label="Review target form?" shape=diamond];
    mr_view [label="mr_view {mrUrl, or repoName + iid}" shape=plaintext];
    mr_view_found [label="mr_view returned the MR?" shape=diamond];
    mr_for_branch [label="mr_for_branch {repoName: <checkout>, branches: [<branch>]}" shape=plaintext];
    branch_entry_found [label="mr_for_branch entry for the branch?" shape=diamond];
    gh_pr_view [label="gh pr view <ref>" shape=plaintext];
    pr_view_found [label="gh pr view found the PR?" shape=diamond];
    mr_list_branch [label="mr_list {repoName: <checkout>, sourceBranch: <branch>, state: all, limit: 200}" shape=plaintext];
    branch_matches [label="mr_list matches for the branch?" shape=diamond];
    mr_list_ticket [label="mr_list {repoName: <checkout>, search: <ticket id>, state: all, limit: 200}" shape=plaintext];
    ticket_matches [label="mr_list matches for the ticket?" shape=diamond];
    run_budget_target_clarify [label="run_budget {runDb, key: target-clarify, limit: 2, stage}" shape=plaintext];
    target_clarify_spent [label="target-clarify spent?" shape=diamond];
    stop_gitlab_shell_search [label="STOP: GitLab ticket searches go through the read tools or gitlab_get" shape=octagon style=filled fillcolor=red fontcolor=white];
    stop_gitlab_shell_reads [label="STOP: GitLab reads go through the read tools or gitlab_get" shape=octagon style=filled fillcolor=red fontcolor=white];
    stop_gitlab_branch_lookup [label="STOP: GitLab branch lookups go through the read tools or gitlab_get" shape=octagon style=filled fillcolor=red fontcolor=white];
    gate_which_target [label="Gate review clarify: which target?" shape=box];
    target_answer [label="Review target answer?" shape=diamond];
    own_run_record_target [label="Own review run: record the target?" shape=diamond];
    record_target [label="Record the review target: mr, branch and any ticket" shape=box];
    caller_decided_report [label="Caller handed a decided selection and the report it decided on?" shape=diamond];
    caller_framed_rereview [label="Caller framed a re-review?" shape=diamond];
    take_earlier_threads [label="Take the earlier threads the caller handed in" shape=box];
    threads_in_hand [label="Earlier threads in hand?" shape=diamond];

    print_depth_block [label="Print the review depth block" shape=box];
    diff_forge [label="Review diff forge?" shape=diamond];
    gh_pr_diff [label="gh pr diff <ref>" shape=plaintext];
    git_fetch_pr_head [label="git fetch origin +pull/<n>/head:refs/remotes/origin/pr-<n>" shape=plaintext];
    git_fetch_mr_head [label="git fetch origin <targetBranch> +refs/merge-requests/<iid>/head:refs/remotes/origin/mr-<iid>" shape=plaintext];
    git_diff [label="git diff origin/<targetBranch>...origin/mr-<iid>" shape=plaintext];
    head_checkout_in_hand [label="MR-head checkout in hand?" shape=diamond];
    worktree_provision [label="worktree_provision {repoName, branch: <source branch>, reuse: true}" shape=plaintext];
    provision_returned_path [label="Review head worktree_provision returned a path?" shape=diamond];
    tree_at_fetched_head [label="Provisioned review tree at the fetched head?" shape=diamond];
    stop_checkout_without_provision [label="STOP: create a review checkout only with worktree_provision" shape=octagon style=filled fillcolor=red fontcolor=white];
    set_up_depth [label="Set up for the review depth" shape=box];
    repro_browser [label="Review repro takes a browser screenshot?" shape=diamond];
    capture_repro [label="Capture the review repro with the browser (browser-evidence)" shape=box];
    dispatch_reviewer [label="Dispatch the fresh reviewer; it forms the findings" shape=box];
    assemble_draft [label="Assemble the review draft" shape=box];
    verify_blocking [label="Verify each blocking finding against the MR head" shape=box];
    blocking_verified [label="Every blocking finding verified?" shape=diamond];
    run_budget_verify_rounds [label="run_budget {runDb, key: verify-rounds:<depth>, limit: 2, stage}" shape=plaintext];
    verify_rounds_spent [label="verify-rounds:<depth> spent?" shape=diamond];
    redispatch_reviewer [label="Re-dispatch a fresh reviewer on the unverified findings" shape=box];
    demote_unverified [label="Demote each unverified finding to Minor, marked unverified" shape=box];
    report_path_given [label="Review report path given?" shape=diamond];
    write_report [label="Write the review report and its json sibling" shape=box];

    caller_selection [label="Caller handed a decided selection?" shape=diamond];
    report_json_in_hand [label="Review report json in hand?" shape=diamond];
    write_post_extras [label="Write review-post.extras.json" shape=box];
    caller_owns_gates [label="Caller owns the review gates?" shape=diamond];
    json_under_temp_root [label="Report json under the temp root?" shape=diamond];
    copy_json_to_scratch [label="Copy the report json into the review scratch dir" shape=box];
    gate_open_extras [label="gate_open {kind: review-post, review: {findingsPath, extras}, runDb, stage, scope: post}" shape=plaintext];
    sh_review_source [label="sh \"${CLAUDE_SKILL_DIR}/scripts/review-source.sh\" <report json> <dir>/review-post.extras.json > <dir>/review-post.source.json" shape=plaintext];
    review_source_exit [label="review-source.sh exit 0?" shape=diamond];
    gate_open_hand_back [label="gate_open {kind: review-post, sourcePath: <dir>/review-post.source.json, handBack: true, outPath: <dir>/review-post.open.json, runDb, stage, scope: post}" shape=plaintext];
    gate_open_result [label="gate_open result?" shape=diamond];
    stop_only_gate_open [label="STOP: only gate_open writes the review-post open; never hand-edit or hand-fit it" shape=octagon style=filled fillcolor=red fontcolor=white];
    run_budget_open_fix [label="run_budget {runDb, key: post-open-fix, limit: 2, stage}" shape=plaintext];
    open_fix_spent [label="post-open-fix spent?" shape=diamond];
    fix_named_field [label="Fix the field the review script names" shape=box];
    gate_off_script_script [label="Open the review off-script gate: a review script refused" shape=box];
    script_off_answer [label="Review script off-script answer?" shape=diamond];
    write_run_line [label="Write the review-run line into the handed --report" shape=box];
    hand_back_severity [label="Hand back the severity line and the open's paths" shape=box];
    caller_answer [label="Review caller's answer?" shape=diamond];
    gate_post_carry [label="Gate review-post: carry the opened gate through gate-protocol" shape=box];
    gate_post_legacy [label="Gate review-post, legacy: tiers, outcome and next" shape=box];
    post_next_answer [label="Review-post next answer?" shape=diamond];
    take_human_changes [label="Take the human's changes into the review draft" shape=box];
    iterate_wants_depth [label="Review iterate note asks for another depth?" shape=diamond];

    posting_forge [label="Review posting forge?" shape=diamond];
    gh_pr_review [label="gh pr review <ref> with the disposition and the summary body" shape=plaintext];
    pr_review_result [label="gh pr review result?" shape=diamond];
    gate_off_script_gh [label="Open the review off-script gate: gh pr review refused" shape=box];
    gh_off_answer [label="gh pr review off-script answer?" shape=diamond];
    gh_pr_comment [label="gh pr comment <ref> with the summary body" shape=plaintext];
    compose_review [label="Compose the submitted review: comments, summary, outcome" shape=box];
    resumed_read_mr_first [label="Resumed run: read the MR first?" shape=diamond];
    mr_posted_since [label="mr_posted_since {mrUrl, since: <run started_at>, items}" shape=plaintext];
    review_already_posted [label="This review already on the MR?" shape=diamond];
    mr_review_submit [label="mr_review_submit {mrUrl, outcome, summary, comments, replies}" shape=plaintext];
    mr_review_submit_result [label="mr_review_submit result?" shape=diamond];
    run_budget_bad_anchors [label="run_budget {runDb, key: bad-anchors, limit: 2, stage}" shape=plaintext];
    bad_anchors_spent [label="bad-anchors spent?" shape=diamond];
    move_bad_anchors [label="Move the bad-anchor findings into the summary" shape=box];
    stop_split_submit [label="STOP: post a review only as one mr_review_submit" shape=octagon style=filled fillcolor=red fontcolor=white];
    gate_off_script_submit [label="Open the review off-script gate: mr_review_submit refused" shape=box];
    gate_off_script_pending [label="Open the review off-script gate: pending comments on the MR" shape=box];
    submit_off_answer [label="Review submit off-script answer?" shape=diamond];
    make_review_move [label="Make the recorded review move once" shape=box];
    mr_approve [label="mr_approve {mrUrl}" shape=plaintext];
    mr_approve_result [label="mr_approve result?" shape=diamond];
    gate_off_script_approve [label="Open the review off-script gate: mr_approve refused" shape=box];
    approve_off_answer [label="Approval off-script answer?" shape=diamond];
    make_approve_move [label="Make the recorded approval move once" shape=box];
    gate_record [label="gate_record {runDb, stage, scope: post, shape: post, gateId | answers + decidedBy}" shape=plaintext];
    own_run_close [label="Own review run: close it?" shape=diamond];
    own_run_abandon [label="Own review run: abandon it?" shape=diamond];
    run_close [label="run_close {runDb, workType: review, stage: review, outcome}" shape=plaintext];
    closed_as [label="Review closed as?" shape=diamond];
    end_with_link [label="End with the review target's forge link" shape=box];
    run_stage_fail [label="run_stage {action: fail, stage: <run.current_stage>, reason: <why; what already posted>}" shape=plaintext];
    run_hold [label="run_hold {runDb, stage, reason, decidedBy}" shape=plaintext];
    held_end_turn [label="Review held: end the turn" shape=doublecircle];
    handed_back_quoted [label="Review handed back: the why and what posted, quoted" shape=doublecircle];
    posted [label="Review posted" shape=doublecircle style=filled fillcolor=lightgreen];

    trigger_review_teammate -> run_enter;
    run_enter -> run_enter_mode;
    run_enter_resume -> run_enter_mode;
    run_enter_fresh -> run_enter_mode;
    run_enter_mode -> resolve_target [label="started, or inherited"];
    run_enter_mode -> run_snapshot [label="resumed"];
    run_enter_mode -> gate_resume_choice [label="candidates"];
    run_enter_mode -> refused_carried_resume [label="refused, or no tool"];
    refused_carried_resume -> run_enter_fresh [label="yes: say so, start fresh"];
    refused_carried_resume -> stop_no_run_without_enter [label="no"];
    gate_resume_choice -> resume_answer;
    resume_answer -> run_enter_resume [label="resume"];
    resume_answer -> run_enter_fresh [label="start fresh"];
    resume_answer -> held_end_turn [label="hold"];
    run_snapshot -> snapshot_records;
    snapshot_records -> resolve_target [label="no post decision: re-enter, reuse every recorded answer"];
    snapshot_records -> own_run_close [label="a post decision"];

    resolve_target -> target_form;
    target_form -> mr_view [label="GitLab URL or iid"];
    target_form -> mr_for_branch [label="GitLab branch"];
    target_form -> gh_pr_view [label="GitHub"];
    target_form -> gate_which_target [label="several candidates"];
    target_form -> mr_list_ticket [label="ticket id only"];
    target_form -> stop_gitlab_shell_search [label="tempted to search with the GitLab CLI"];
    stop_gitlab_shell_search -> mr_list_ticket;
    mr_for_branch -> branch_entry_found;
    branch_entry_found -> mr_view [label="an iid"];
    branch_entry_found -> mr_list_branch [label="null: no open MR"];
    branch_entry_found -> run_hold [label="an error: hold, quoting it"];
    branch_entry_found -> stop_gitlab_branch_lookup [label="tempted to look it up with the GitLab CLI"];
    stop_gitlab_branch_lookup -> mr_list_branch;
    mr_list_branch -> branch_matches;
    branch_matches -> mr_view [label="exactly one"];
    branch_matches -> run_hold [label="none: hold"];
    branch_matches -> gate_which_target [label="several, or truncated"];
    branch_matches -> run_hold [label="an error: hold, quoting it"];
    mr_list_ticket -> ticket_matches;
    ticket_matches -> mr_view [label="exactly one, untruncated"];
    ticket_matches -> gate_which_target [label="none, several, or truncated"];
    ticket_matches -> gate_which_target [label="an error: quoted in the gate"];
    mr_view -> mr_view_found;
    mr_view_found -> own_run_record_target [label="yes"];
    mr_view_found -> run_hold [label="an error: hold, quoting it"];
    mr_view_found -> stop_gitlab_shell_reads [label="tempted to read it with the GitLab CLI"];
    stop_gitlab_shell_reads -> mr_view;
    gh_pr_view -> pr_view_found;
    pr_view_found -> own_run_record_target [label="yes"];
    pr_view_found -> run_hold [label="no: hold, quoting it"];
    gate_which_target -> target_answer;
    target_answer -> target_form [label="a target picked"];
    target_answer -> run_budget_target_clarify [label="their text"];
    target_answer -> run_hold [label="next: hold"];
    run_budget_target_clarify -> target_clarify_spent;
    target_clarify_spent -> target_form [label="no: resolve it"];
    target_clarify_spent -> run_hold [label="yes: hold"];
    own_run_record_target -> record_target [label="yes"];
    own_run_record_target -> caller_decided_report [label="no: inherited"];
    record_target -> caller_decided_report;
    caller_decided_report -> posting_forge [label="yes: post it; review nothing again"];
    caller_decided_report -> run_hold [label="yes, but a selected id the json lacks: hold, quoting it"];
    caller_decided_report -> caller_framed_rereview [label="no"];
    caller_framed_rereview -> take_earlier_threads [label="yes"];
    caller_framed_rereview -> print_depth_block [label="no"];
    take_earlier_threads -> threads_in_hand;
    threads_in_hand -> print_depth_block [label="yes, or none to judge"];
    threads_in_hand -> run_hold [label="no: the read errored"];

    print_depth_block -> diff_forge;
    diff_forge -> gh_pr_diff [label="GitHub"];
    diff_forge -> git_fetch_mr_head [label="GitLab"];
    git_fetch_mr_head -> git_diff;
    git_diff -> head_checkout_in_hand;
    gh_pr_diff -> git_fetch_pr_head;
    git_fetch_pr_head -> head_checkout_in_hand;
    head_checkout_in_hand -> set_up_depth [label="yes, or read depth"];
    head_checkout_in_hand -> worktree_provision [label="no: verify or repro"];
    head_checkout_in_hand -> stop_checkout_without_provision [label="tempted to create one by hand"];
    stop_checkout_without_provision -> worktree_provision;
    worktree_provision -> provision_returned_path;
    provision_returned_path -> tree_at_fetched_head [label="yes"];
    provision_returned_path -> dispatch_reviewer [label="no: checks not run"];
    tree_at_fetched_head -> set_up_depth [label="yes"];
    tree_at_fetched_head -> dispatch_reviewer [label="no: checks not run"];
    set_up_depth -> repro_browser;
    repro_browser -> capture_repro [label="yes"];
    repro_browser -> dispatch_reviewer [label="no: read or verify depth, or the domain's own method"];
    capture_repro -> dispatch_reviewer [label="Board ready or Not drawn"];
    dispatch_reviewer -> assemble_draft;
    assemble_draft -> verify_blocking;
    verify_blocking -> blocking_verified;
    blocking_verified -> report_path_given [label="yes, or none blocking"];
    blocking_verified -> run_budget_verify_rounds [label="no"];
    run_budget_verify_rounds -> verify_rounds_spent;
    verify_rounds_spent -> redispatch_reviewer [label="no"];
    verify_rounds_spent -> demote_unverified [label="yes"];
    redispatch_reviewer -> assemble_draft;
    demote_unverified -> report_path_given;
    report_path_given -> write_report [label="yes"];
    report_path_given -> caller_selection [label="no"];
    write_report -> caller_selection;

    caller_selection -> posting_forge [label="yes: use it, ask nothing"];
    caller_selection -> report_json_in_hand [label="no"];
    report_json_in_hand -> write_post_extras [label="yes"];
    report_json_in_hand -> gate_post_legacy [label="no"];
    write_post_extras -> caller_owns_gates;
    caller_owns_gates -> sh_review_source [label="yes: a board wrapper said so"];
    caller_owns_gates -> json_under_temp_root [label="no: direct run"];
    json_under_temp_root -> gate_open_extras [label="yes"];
    json_under_temp_root -> copy_json_to_scratch [label="no"];
    copy_json_to_scratch -> gate_open_extras;
    gate_open_extras -> gate_open_result;
    sh_review_source -> review_source_exit;
    review_source_exit -> gate_open_hand_back [label="yes"];
    review_source_exit -> run_budget_open_fix [label="exit 1: names a field"];
    review_source_exit -> gate_off_script_script [label="exit 2"];
    gate_open_hand_back -> gate_open_result;
    gate_open_result -> gate_post_carry [label="opened"];
    gate_open_result -> write_run_line [label="handed back"];
    gate_open_result -> run_budget_open_fix [label="refused: names a field"];
    gate_open_result -> gate_off_script_script [label="refused: no field to fix"];
    gate_open_result -> stop_only_gate_open [label="tempted to edit or fit the open by hand"];
    stop_only_gate_open -> gate_off_script_script;
    run_budget_open_fix -> open_fix_spent;
    open_fix_spent -> fix_named_field [label="no"];
    open_fix_spent -> gate_off_script_script [label="yes"];
    fix_named_field -> caller_owns_gates;
    gate_off_script_script -> script_off_answer;
    script_off_answer -> gate_post_legacy [label="take"];
    script_off_answer -> write_post_extras [label="iterate here"];
    script_off_answer -> run_hold [label="hold"];
    script_off_answer -> own_run_abandon [label="hand back"];
    write_run_line -> hand_back_severity;
    hand_back_severity -> caller_answer;
    caller_answer -> posting_forge [label="{findings, outcome}"];
    caller_answer -> run_hold [label="hold"];
    gate_post_carry -> post_next_answer;
    gate_post_legacy -> post_next_answer;
    post_next_answer -> posting_forge [label="proceed"];
    post_next_answer -> take_human_changes [label="iterate here"];
    post_next_answer -> run_hold [label="hold"];
    take_human_changes -> iterate_wants_depth;
    iterate_wants_depth -> print_depth_block [label="yes"];
    iterate_wants_depth -> report_path_given [label="no: a new gate next"];

    posting_forge -> gh_pr_review [label="GitHub"];
    posting_forge -> compose_review [label="GitLab"];
    gh_pr_review -> pr_review_result;
    pr_review_result -> gate_record [label="posted"];
    pr_review_result -> gate_off_script_gh [label="error"];
    gate_off_script_gh -> gh_off_answer;
    gh_off_answer -> gh_pr_comment [label="take"];
    gh_off_answer -> gh_pr_review [label="iterate here"];
    gh_off_answer -> run_hold [label="hold"];
    gh_off_answer -> own_run_abandon [label="hand back"];
    gh_pr_comment -> gate_record;
    compose_review -> resumed_read_mr_first;
    resumed_read_mr_first -> mr_review_submit [label="no: a first pass"];
    resumed_read_mr_first -> mr_posted_since [label="yes: resumed"];
    mr_posted_since -> review_already_posted;
    review_already_posted -> mr_review_submit [label="no"];
    review_already_posted -> gate_off_script_approve [label="yes, approval outstanding"];
    review_already_posted -> gate_record [label="yes, nothing outstanding"];
    review_already_posted -> gate_off_script_submit [label="partly"];
    review_already_posted -> run_hold [label="the read errored"];
    mr_review_submit -> mr_review_submit_result;
    mr_review_submit_result -> gate_record [label="published, approved as asked"];
    mr_review_submit_result -> gate_off_script_approve [label="published, approved: false on an approve"];
    mr_review_submit_result -> run_budget_bad_anchors [label="published: false, bad-anchors"];
    mr_review_submit_result -> gate_off_script_pending [label="published: false, pending-drafts"];
    mr_review_submit_result -> gate_off_script_submit [label="error"];
    mr_review_submit_result -> stop_split_submit [label="tempted to post pieces with mr_comment_inline, mr_comment, mr_reply_thread, mr_resolve_thread or the GitLab CLI"];
    stop_split_submit -> gate_off_script_submit;
    run_budget_bad_anchors -> bad_anchors_spent;
    bad_anchors_spent -> move_bad_anchors [label="no"];
    bad_anchors_spent -> gate_off_script_submit [label="yes"];
    move_bad_anchors -> mr_review_submit;
    gate_off_script_submit -> submit_off_answer;
    gate_off_script_pending -> submit_off_answer;
    submit_off_answer -> make_review_move [label="take"];
    submit_off_answer -> mr_review_submit [label="iterate here"];
    submit_off_answer -> run_hold [label="hold"];
    submit_off_answer -> own_run_abandon [label="hand back"];
    make_review_move -> gate_record;
    mr_approve -> mr_approve_result;
    mr_approve_result -> gate_record [label="approved"];
    mr_approve_result -> gate_off_script_approve [label="refused"];
    gate_off_script_approve -> approve_off_answer;
    approve_off_answer -> make_approve_move [label="take"];
    approve_off_answer -> mr_approve [label="iterate here"];
    approve_off_answer -> run_hold [label="hold"];
    approve_off_answer -> own_run_abandon [label="hand back"];
    make_approve_move -> gate_record;
    gate_record -> own_run_close;
    own_run_close -> run_close [label="yes: done"];
    own_run_close -> end_with_link [label="no: inherited"];
    own_run_abandon -> run_close [label="yes: abandoned"];
    own_run_abandon -> run_stage_fail [label="no: inherited"];
    run_close -> closed_as;
    closed_as -> end_with_link [label="done"];
    closed_as -> handed_back_quoted [label="abandoned"];
    end_with_link -> posted;
    run_stage_fail -> handed_back_quoted;
    run_hold -> held_end_turn;
}
```

### Gate review clarify: Resume / Start fresh / Hold

No run is yours yet: use the in-pane structured-question tool. One
sentence naming each candidate's `spawnedBy`, `startedAt` and
`currentStage`; one **Resume** option per candidate this pane may take
(this session's, `ownSession: true`, recommended; or one no live pane
owns), naming one another live pane owns unavailable; then **Start fresh**
and **Hold**. A launched pane never gets here: with `spawnedBy` and no
`resume`, `run_enter` starts fresh. Hold records nothing.

### The refused review run_enter carried resume?

A refused resume means the run is gone or no longer running: say so in one
line and start fresh with the first call's `spawnedBy`. Any other refusal
ends the review: quote it verbatim and whole, never a paraphrase or a
guessed cause. Only with no `run_enter` tool at all, say rt predates the
run tools; update rt.

### Resolve the review target

From the conversation (an MR/PR URL, `!iid` or `#number`, a ticket id, or
a branch name), or on a resume in a new session the snapshot's `mr`.
`mr_view` takes `mrUrl`, else `repoName` (the checkout path) plus `iid`,
and resolves any MR your token can see, by anyone, in any state. Quote a
read error, never paraphrase it (usually GitLab's 404 or 403; or rt's:
target not resolved, daemon unreachable, timeout), and hold with it
(`decidedBy: "pane"`). A null `mr_for_branch` entry means no open MR, not
none: `mr_list` by `sourceBranch` sees every state.

### mr_list matches for the branch?

`truncated: true` (more than the 200 returned) is ambiguous whatever the
list holds: the clarify gate, saying it was cut at 200 rows, one option
per MR returned. Otherwise exactly one goes to `mr_view` by its `iid`;
none holds with "GitLab has no MR for the branch" (`decidedBy: "pane"`);
several take the clarify gate, one option per MR (iid, title, state).
Never a guess.

### mr_list matches for the ticket?

Keep the returned rows whose `sourceBranch` or `title` carries the id.
`truncated` first, as for the branch. Exactly one kept row goes to
`mr_view`; none is the clarify gate with no options, saying no returned
row carries the ticket (not that no MR exists), their typed text the
answer; several is the clarify gate, one option per row (iid, title,
state). An error is quoted in the gate's sentence, never read as none.
Never a guess.

### Reading a GitLab fact no read tool returns

A GitLab fact no read tool returns (the MR's commits, a
referenced issue, another MR's state) is `gitlab_get {repoName, path}`,
`repoName` the checkout path, `path` relative to the API root, `:id` this
project (`projects/:id/merge_requests/<iid>/commits`). It opens no gate.
Quote a GitLab error as written; a refused credential path is final.

### Gate review clarify: which target?

One sentence naming the candidates, quoting a failed read's error, or
saying the list was cut at 200 rows or nothing was found. Then
gate-protocol's Runs integration from `Trigger: a site reaches its gate`:
`gate_ask {questions, kind: clarify, context, runDb, stage}`, questions `target` (one option per candidate;
none when nothing was found or a read failed: their typed text answers)
and `next`: **Proceed** (recommended) / **Hold**. `next: hold` holds
whatever `target` says. A picked
target resolves; typed text charges `target-clarify` and resolves again,
and a spent budget's hold names what was tried.

### Record the review target: mr, branch and any ticket

`run_field_set` with `stage: review`: `key: mr` (the MR or PR URL), `key:
branch` (its source branch), and `key: ticket` only when the MR or PR
itself names one.

### Caller handed a decided selection and the report it decided on?

Yes when the caller hands a decided selection (`{findings, outcome}`, or
legacy `{tiers, outcome}`) together with the `--report` the human decided
it on: the review already ran in an earlier pane, a board's fresh pane or
a resume of this run included. Go straight to posting. The selection may
carry `texts` (`{<finding id>: <text>}`, the human's edits) and
`summaryText` (the summary line's edit); Compose takes them as it takes
the gate answers' `texts` and the `outcome` answer's `text`. Compose reads
each selected finding's draft, anchor and tier from the report's json
sibling (the report itself for a legacy selection) as written. Print no depth
block, fetch, diff, provision or dispatch nothing, and never rewrite the
report or its json: a second pass forms new findings whose ids and
anchors are not the ones the human picked. A selected finding id the json
lacks means the selection was decided on another revision of the report:
hold, quoting the missing ids, and never post a partial set. On a resumed
run the post still reads the MR first (`This review already on the MR?`).
No: a
selection handed with no report, or none handed, goes on to the review.

### Caller framed a re-review?

Yes only when the caller says this pass re-reviews an already reviewed
change; a hand-typed review, or a caller silent on earlier rounds, is a
first review.

### Take the earlier threads the caller handed in

A re-review judges the earlier threads first, then what is new. The caller
hands in the threads (each with `discussionId`, anchor, `round`, the
reviewer's first note and the author's replies), the last reviewed commit
and the round number, or the rule that picks the threads and their
`round`: then read `mr_threads {mrUrl, refresh: true}` and keep exactly
what it picks (an error answers no at `Earlier threads in hand?`). With
none, it is a full review framed as a re-review, `threads` empty.

The skipped list comes too, each `{id, round, title, severity, file,
line, excerpt, snippet}` with the sha of the round that skipped it: every
one comes back under the json's `skipped`, never raised again, since an
issue a skipped finding already says is not new.

This step judges nothing. Each thread's call (one of the structured
findings file's four, with a one-line note and a reply in the writing
style) and the new issues form in the fresh reviewer, weighting `git diff
<last reviewed sha>..HEAD` over the whole change, `HEAD` the MR head
(`origin/mr-<iid>`, or `origin/pr-<n>`, with no MR-head checkout in hand).
A missing, `unknown` or unfetched last reviewed commit makes the whole
change what changed.

### Print the review depth block

The review flow's Commit to a review depth, its HARD-GATE included. Size
the change from what resolving it returned (title, description, changed
files).

### MR-head checkout in hand?

In hand: a checkout already at the MR head, one a caller handed or this
pane's own tree. `read` depth runs nothing: yes. At `verify` or `repro`
with none, provision one (`repoName` this checkout's path, `branch` the
source branch, `reuse: true`) and run every check in its `path`, never
changing this pane's directory; rt disposes it after the merge, never you.
A refusal is quoted in the setup observations, the setup checks and the
verify command check noted as not run.

### Review head worktree_provision returned a path?

`kind: "provisioned"` or `"reused"` returns a `path`: yes, and the head
check decides whether it is usable. A refusal is no.

### Provisioned review tree at the fetched head?

Compare `git rev-parse HEAD` in that path with `origin/mr-<iid>` (or
`origin/pr-<n>`). A mismatch is not in hand: quote both shas, and note the
setup checks and the verify command check as not run. Never reset or pull
that tree.

### Set up for the review depth

The review flow's Set up for the depth, in the MR-head checkout
(`targetBranch` from `mr_view`). Record every command and its result.

### Review repro takes a browser screenshot?

Yes at `repro` depth when EVIDENCE CHECK is `screenshot` and the Criteria
point at a browser target (a `## Browser target` section, in the criteria
or in the file they point at for it) whose What proves a change names a
view for this change, or that has no What proves a change block. Bound
criteria with no browser target answer no: the repro keeps the domain's
own method. With nothing bound, yes when the repro's evidence is a
screenshot of a web page. `read` and `verify` depth answer no.

### Capture the review repro with the browser (browser-evidence)

The review flow's A browser screenshot at repro, in the MR-head checkout:
browser-evidence's `Draw the boards` (Browser evidence below), one brief
per view built from the browser target, `<mr iid>` the MR's iid (on
GitHub, the PR number). The board stays in `~/.fast-browser/screenshots/`
and is cited by path, never recorded or uploaded. A board ready, or Not
drawn with its reason, goes into the setup observations and on to the
dispatch.

### Dispatch the fresh reviewer; it forms the findings

The review flow's Dispatch the review, reviewer shape, full payload: the
findings form in that fresh context, never here, and it makes its own
`gitlab_get` reads. On a re-review one block follows the standard blocks:
the earlier threads and last reviewed commit, asking each thread's call and
note ahead of the Strengths and findings on new issues only, and the
skipped findings (anchor, title, excerpt), never new findings.

### Assemble the review draft

The review flow's Assemble the draft, Earlier threads first on a
re-review. On a second verify round, keep what round one verified and take
the re-dispatch's answer for the rest.

### Verify each blocking finding against the MR head

Blocking is Critical and Important; Minor is not verified. Check each
blocking finding's facts, never its reasoning:

- **Anchor:** the file exists at the head sha and the cited line is
  non-blank there (`git show <head>:<file>`, head `origin/mr-<iid>` or
  `origin/pr-<n>`), in the diff or not, since a change can break an
  unchanged line. No `file` anchor: check quote and command only.
- **Quote:** quoted code appears at or near that line.
- **Command:** a named command re-runs only in the MR-head checkout; with
  none, skip and note it ("not run at read depth" at `read`). One that
  passes where the finding says it fails is a failed check.

A round leaving a blocking finding unverified charges
`verify-rounds:<depth>`, the depth in force (`read`, `verify`, `repro`).

### Re-dispatch a fresh reviewer on the unverified findings

One fresh-context dispatch, same template, naming each failed check
verbatim and asking it to
confirm each finding with a corrected anchor or withdraw it.

### Demote each unverified finding to Minor, marked unverified

Each finding that failed round two moves to Minor, its `body` prefixed
`Unverified: <the failed check>.` Readiness is never raised by a demotion;
the reasoning gains one sentence naming the demoted findings. The json,
written afterward, mirrors the demoted draft; demotion never edits an
already-written json.

### Write the review report and its json sibling

The review flow's "Structured findings file", written after verification
and any demotion so the json mirrors the verified draft. This verb asks
for drafts: the json also carries every comment that will post, drafted
here, before any gate opens.

1. Load the writing style (Writing style, below) first, unless this run
   already loaded it.
2. Each finding's `comment`: its whole comment as it will post, in that
   voice, saying what is wrong, why it matters and what to change. A
   demoted finding's comment says it is unverified, as its `body` does.
3. `summary.comments`: one summary line per verdict the gate will offer,
   keyed by the option values of the extras' `outcome` question:
   `{"comment": "...", "approve": "..."}`, plus `request_changes` only
   when this verb runs the gate on GitHub. Exactly those keys, never one
   more or one fewer. Each value is the whole summary line for that
   verdict, in that voice, with the strengths and the assessment said as
   the reviewer wants them. None holds an issue list: each ticked finding
   with no diff line joins it at post time (Compose).
4. Write each line for its own verdict, whatever readiness says, so
   review-posting's tacit-approval rule shapes every line now. The
   `approve` line is the only one that may say the MR is ready to merge,
   good to merge, LGTM or nothing blocking. The `comment` line leaves the merge
   call to the author, or says approval is withheld pending the notes.
   The `request_changes` line says what must change before it merges.

These drafts are the text that posts. Once a gate is built from the json,
nothing rewrites it; an iterate drafts again only for the new gate.

### Write review-post.extras.json

Make one new directory in this session's scratchpad (the Claude Code temp
root, where `gate_open` reads and writes), never `mktemp -d`, and write its
path out literally from then on. Write `<dir>/review-post.extras.json`:

```json
{"target": "!87", "reviewer": "<the reviewer the caller names>", "round": 2,
 "editable": true,
 "questions": [
   {"id": "outcome", "label": "Verdict on !87: <readiness clause>", "multi": false,
    "options": [{"value": "comment", "label": "comment (recommended)", "description": "<what picking it does for this review>"},
                {"value": "approve", "label": "approve", "description": "<what picking it does for this review>"}]},
   {"id": "next", "label": "Next", "multi": false,
    "options": [{"value": "proceed", "label": "proceed (recommended)"}, "iterate", "hold"]}
 ]}
```

| Field | Filled from |
|---|---|
| `target` | `!<iid>` or `#<number>`, as the forge writes it |
| `reviewer`, `round` | only when the caller supplies them (a re-review's caller supplies `round`); else omit the key |
| `editable` | `true` when the report json carries a `comment` on every finding and `summary.comments` with exactly one line per `outcome` option value (this verb's own drafts); else omit the key. It tells the board this poster posts the edited text, else the draft, word for word |
| `outcome` label | `Verdict on <target>: ` plus a clause composed from the json's `summary`, never a field verbatim: readiness `yes` reads "ready to merge"; `with-fixes` or `no` reads "not ready" or "ready once <the gist of the reasoning>" |
| `outcome` options | `comment` and `approve`, each described by what picking it does; `request_changes` only when this verb runs the gate on GitHub (rt's GitLab tools have none). The recommendation goes FIRST, its label ending ` (recommended)`: `approve` when readiness is `yes`, else `comment`. The question's id is always `outcome`, and its option values are exactly the keys of the json's `summary.comments` |
| `next` | only when this verb runs the gate; a caller that owns the gates navigates itself |

Direct, the object is `gate_open`'s inline `extras`, the report json (or
its copy) the `findingsPath`; on the hand-back path the file goes to
`review-source.sh`. Both build one open whose question ids key the
answers: `thread-<n>` (options `post:<discussionId>`,
`resolve:<discussionId>`), `findings-<n>` (finding ids), `skipped-<n>`
(`restore:<id>`), `outcome`, `next`. A pre-v2 report json opens as
prose, which is not an error. Never hand-edit it or shorten a body to fit.

### Copy the report json into the review scratch dir

`gate_open` reads `findingsPath` only under the temp root (or an installed
plugin root): copy a report json from elsewhere (a caller's `--report`
sibling) into `<dir>` unchanged and pass the copy; the originals stay put.
Every pass copies again, so fix the original (or the extras), never the
copy.

### review-source.sh exit 0?

The hand-back path only: the board's prose step reads
`<dir>/review-post.source.json`, so build it with the vendored script.
Exit 1 names a field to fix (the extras, or the
report json where it drifted from the draft); exit 2 is a usage or
unreadable-input error, nothing to fix.

### gate_open result?

- **Opened** (direct): keep `id`, `paneAction` and `formChunks`; the tool
  wrote `gate` and stored the source as `extra.gate-source.post`.
- **Handed back:** nothing opened; the open is at `outPath` in
  `gate-ctx.sh fit`'s shape, its source beside it, `droppedContexts`
  naming any context the pane form left out for its budget.
- **Refused:** nothing opened, one problem per line. A line naming a field
  in the extras or the report json is a field to fix; a refusal no field
  fix can mend (a file it cannot read or parse, a path outside the read
  roots) goes straight to the off-script gate.

### Fix the field the review script names

Fix exactly the named field (a `gate_open` line, or `review-source.sh`
exit 1), in the extras or the report json where it drifted from the draft.
Then back through
`Caller owns the review gates?` to the same open.

### Write the review-run line into the handed --report

Write one `review-run: <run id>` line (`run_enter`'s `runId`) into the
handed `--report`, replacing any earlier one; with no `--report`, nothing.
A fresh pane the board later hands a decision to resumes this run, and
its stored gate source, by that id. The board never reads the line.

### Hand back the severity line and the open's paths

A caller that owns the gates (a board wrapper says so when it delegates)
gets no gate from this verb. Hand back the severity line; the absolute
paths of `<dir>/review-post.open.json` (its source beside it as
`review-post.source.json`) and of this skill's vendored
`${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`; any `droppedContexts`; and on
GitLab the MR head sha this review read (`mr_view`'s `mr.sha`). Then wait
for its `{findings, outcome}` (plus `replies` and `restored` on a
re-review) or its hold.

### Gate review-post: carry the opened gate through gate-protocol

Enter gate-protocol at `Trigger: a site opened its gate with gate_open`
with the result and walk on from `paneAction?`. On a review gate neither
`gate_answer` nor `gate_reconcile` records: keep the gate's `id` and
answers map for Compose; the `gate_record` after posting is the record.
`contextDropped: true` means only the pane form left some context out;
the gate stores every context whole and stays open as it is: carry on.

### Gate review-post, legacy: tiers, outcome and next

No report json leaves nothing to build from. Gate-protocol's Runs
integration from `Trigger: a site reaches its gate`: `gate_ask {questions,
kind: review-post, scope: post, context, runDb, stage}`, `context` the severity line verbatim, questions
`tiers` (multi-select over the levels present, all pre-selected), then
`outcome` and `next` as in the extras. It records nothing either; the post
record reads `tiers` as the legacy selection.

### Take the human's changes into the review draft

Apply their text to the draft. Asking for another depth goes back to the
depth block under a fresh
`verify-rounds:<depth>` key, since new setup means a fresh verify.
Anything else is a draft edit: re-present, and the next gate is a NEW
gate.

### Compose the submitted review: comments, summary, outcome

One call carries the whole review. Selected findings: the union of the
`findings-<n>` answers (`{value, note, texts}` unwraps to its value), a
legacy `tiers` answer's whole tiers, or the caller's selection (each
finding as the report json it was decided on writes it). `outcome`: the
picked option's value, `comment` or `approve` (or `request_changes` on
GitHub).

**The json carries drafts** (its `summary` has `comments`): every text
below is taken as it stands, never written here. On GitHub the same texts
and the same summary build the `gh pr review` body (the paragraph after
review-posting, below).

- A finding's text: the `texts` entry at its id (from any `findings-<n>`
  answer, or the caller's `texts`), else its `comment` in the report json
  the selection was decided on. That json holds what the gate showed on
  both paths: a board's fresh posting pane has only that json, and nothing
  rewrites it after the gate opens.
- The summary line: the `outcome` answer's `text` (the caller's
  `summaryText`), else `summary.comments[<the picked outcome value>]`,
  the line drafted for that verdict. Never another verdict's line, even
  when readiness or the recommendation points elsewhere: an `approve`
  line never posts under a Comment.
- `comments`: one `{body, path, line}` per selected finding with both
  `file` and `line`, `body` its text.
- `summary`: the board's `joinSummary` rule. It is the summary line, then
  the text of each selected finding without both `file` and `line`, in
  gate order (Critical, Important, Minor; json order within a tier), each
  preceded by one blank line. A folded finding's text is the `texts` entry
  at its id (a `findings-<n>` answer's `texts`, or the caller's `texts`),
  else its `comment` in the report json. A folded finding the human
  edited posts the edit, never the draft: copy it from `texts`, not from
  the json. Nothing else is added: no heading, label, anchor, bullet or
  issue list. So the summary posts exactly as the board's summary card
  showed it.
- At most 100 comments and replies in all. Past that, the lowest-tier
  anchored findings go into the summary after the joined part, each
  preceded by one blank line, their text word for word.
- No text is reworded, trimmed, restyled or put into the voice here, and
  an answer's `note` never changes posted text.

**The json carries no drafts** (an older report, or a pack not yet
recompiled): `body` is the finding's tier, title and what to change, and
`summary` is the review-posting summary, its issue list holding each
selected finding without both `file` and `line`. Past 100 comments and
replies, the lowest-tier anchored findings go to the issue list.

`replies`: one per `thread-<n>` answer that picked anything,
`discussionId` from the value after `post:` or `resolve:`, `resolve` true
for `resolve:<id>`, `body` only for `post:<id>`: the answer's `text` when
present (the human's edit), else the report json's `reply`. A caller's
decided `replies` go in unchanged.

A `restore:<id>` answer brings that skipped finding back, posting as
review-posting says for restored findings, its text the caller's record
verbatim, never rewritten: the caller's `restored` entry (`title`, then
`body`) when it decided the selection, else the handed skipped entry
(`title`, then `excerpt`). Its `changed` is the `restored` entry's, else
the report json's `skipped` entry's. When the json carries drafts, a
restored finding that posts in the summary is never one of the joined
findings: it follows the joined part, preceded by one blank line, with its
recorded `file:line` and text.

### This review already on the MR?

Asked on GitLab after Compose, before anything posts. A first pass
(`started` or `inherited`) answers no without a read. A resumed run with no
post decision reads the MR before any submit, whatever its holds say,
since a submit can land after the run's last record:

`mr_posted_since {mrUrl, since: <the snapshot's run.started_at>, items}`

`items`: `{id: "summary", contains: <the first line of the summary Compose
built>}`, then per comment `{id: <finding id>, contains: <the first line
of the body Compose built for it>, path, line}`: the text this submit
sends, edit or draft, never the json's other fields. All `posted` is yes, some is partly, none is no; never judge it
from a thread read, and a read error holds, quoting it. The latest hold's
reason adds what the read cannot show: a review it names as posted by the
human is posted, and on an approve, an approval it does not name as landed
is outstanding. Yes with the approval outstanding is the approval gate
(iterate runs `mr_approve` alone, never a second submit); yes with nothing
outstanding is the post record; partly is the refused-review gate, where
the human finishes the review in the forge UI; no is submit.

### Move the bad-anchor findings into the summary

`badAnchors` names comments by `index`, zero-based in the `comments` sent;
nothing posted. When the json carries drafts, append each to the summary,
preceded by one blank line: its `file:line` alone on a line, then its body
word for word. That `file:line` is the one change the post step makes to
text the human saw. With no drafts, move each into the summary's issue
list, its `file:line` in the text. Then call again with the rest
unchanged.

### Make the recorded review move once

The human made the recorded move in the forge UI. Post nothing: record
it, once, and go on to the post record.

### Make the recorded approval move once

Exactly the move the gate recorded for the refused approval, once.

### End with the review target's forge link

End with the target's id as a markdown link to its real web URL
(review-posting's close HARD-GATE): a posting tool's, else `mr_view`'s
`webUrl` (or `gh pr view`'s url), else on a resume the snapshot's `mr`.

### Open the review off-script gate: a review script refused

Opens at once on a refusal no field fix can mend (`review-source.sh` exit
2, a `gate_open` refusal of an unreadable file or a path outside the read
roots), and on a field refusal once `post-open-fix` is spent. Proposed
move: the legacy gate in place of the structured open.

### Open the review off-script gate: gh pr review refused

Proposed move: post the summary body as a plain PR comment with `gh pr
comment <ref>`, leaving the disposition to the human.

### Open the review off-script gate: mr_review_submit refused

A timeout, an unknown outcome or a partial landing may have left some or
all of this review on the MR; any other error means nothing is up.
Proposed move: the human posts the review in the forge UI, approving on an
approve (the summary and every comment quoted in full in `context`),
recorded as posted by the human.

- **Timed out, or outcome unknown:** `context` first says some or all of
  it may be up; the human looks for the summary first, and one already up
  means take records it without posting again.
- **Only partly landed:** `context` first says some comments may be up
  without the summary, so the human checks the MR's threads. Take only:
  the human finishes the review in the forge UI, summary included.

`context` then says **Iterate here** is only for a human who confirmed
nothing from this review is up, never a blind resubmit. From `This review
already on the MR?` with partly, it quotes the hold reason and which
`mr_posted_since` items are posted.

### Open the review off-script gate: pending comments on the MR

The reviewer has pending comments here (from the forge UI or an earlier
failed submit) that a submit would publish with the review. `context`
quotes their count and first lines. The human submits or discards them in
the forge UI, so **Iterate here**, retrying the same call, is the
recommended `next`. Take: the human posts this review in the forge UI with
their pending comments (the summary and every comment quoted in full),
recorded as posted by the human.

### Open the review off-script gate: mr_approve refused

The review is posted; only the approval failed. Proposed move: the human
approves in the forge UI, recorded as theirs. Iterate retries `mr_approve`
alone, never the review. `context` quotes the submit's `approveError`, a
refused `mr_approve`'s error, or, from `This review already on the MR?`,
the hold reason naming the approval outstanding.

## Review off-script gates

Every off-script box opens gate-protocol's `## Off-script gate` at site
`review` (scope `off-script:review:<n>`, `n` from 1 in this run), `context`
quoting the refusal verbatim, under the run, in this pane even when a board
owns the review gates.

Route: `action: handback` is hand back whatever `next` says; otherwise
`next: iterate` is iterate here (a retry with their note; each failed
retry opens a new gate), `hold` is `run_hold` with their words, `proceed`
is take. A hold's or hand-back's reason says what is on the MR; from the
submit, pending-comments or approval gate it always says whether this
review is posted (by the submit, by the human, partly, or outcome unknown)
and, on an approve, whether the approval is outstanding: what `This review
already on the MR?` reads on a resume.

## What the graph cannot show

- Review verbs produce judgment and execute posting; they never decide
  what posts.
- The draft is presented once, after verify and any demotion, then the
  severity levels present in one line, for example "Findings: Critical
  (2), Important (1); 3 findings.", skipping empty levels, counted on the
  demoted draft before any selection.
- A caller's decided selection is `{findings, outcome}` or legacy
  `{tiers, outcome}` (plus `texts` and `summaryText` when the human edited
  drafts, and `replies` and `restored: [{id, title, body, file, line,
  changed}]` on a re-review), with the decider to use. Posting
  gets it as `{findings: <ids>, disposition: <outcome>}` (legacy `{levels:
  <tiers>, disposition: <outcome>}`), restored findings selected, never
  deselected.
- The post record, `gate_record {runDb, stage, scope: post, shape: post}`,
  comes only once the review is up (by the submit, `gh`, or the human on a
  take): rt reads the latest post decision as what posted. Pass `gateId`
  for an answered gate, or the caller's selection as `answers` with its
  named `decidedBy`; the tool builds the record.
- A hold is one `run_hold` (`reason` the human's words or the quoted
  error, `decidedBy` the answer's by, `pane` for an error); then the turn
  ends. A gate that comes back `closed` is a hold, reason "gate closed".
- `run_close` takes `outcome: done` after the post record, or `abandoned`
  with `reason: <why; what already posted>` on a hand back.
- A fetch, diff or `gh pr diff` that errors is a hold quoting the error.

## The review flow

The boxes from **Print the review depth block** through **Assemble the
review draft** follow this flow; apply its Criteria triage lines and
addendum exactly as it directs.

{{include:review-core-body}}

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

## Criteria

{{slot:criteria}}

{{include:review-core-body-after}}

{{include:review-dispatch-body}}

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

## Reviewer

{{slot:reviewer}}

{{include:review-dispatch-body-after}}

{{include:review-core-body-tail}}

## Browser evidence

{{include:browser-evidence}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}

{{include:writing-style-lookup}}

{{include:review-posting}}

On GitLab that one review is `mr_review_submit` (comments, summary,
outcome; `replies` on a re-review): `published: true` with `mrUrl`, the
close's link, or `published: false` with the reason and nothing posted.
The daemon places each comment, so never hand-build a position payload or
post a finding with `mr_comment_inline`. GitHub has no inline mechanism:
every selected finding rides in the one `gh pr review` body with its
`file:line`. When the json carries drafts, that body is built from
Compose's texts (edit, else draft) and adds no wording: the joined summary
exactly as Compose builds it, then each selected finding with both `file`
and `line`, in gate order, preceded by one blank line, as its `file:line`
alone on a line and then its text word for word. A restored finding
follows them the same way, with its recorded anchor and text. The same
body is what `gh pr comment` posts on a take.
