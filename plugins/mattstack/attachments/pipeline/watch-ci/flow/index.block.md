---
order: 2
---

# Flow

`<root>` is the worktree root (`git rev-parse --show-toplevel`), `<mr>` the
MR's or PR's https URL. Every CI tool, `mr_view` and `mr_ready` take
`mrUrl: <mr>`, the form the graph shows. When `<root>` is a checkout of
the MR's project, `ci_watch`, `ci_triage`, `pipeline_jobs`,
`mr_job_trace`, `mr_retry`, `mr_view` and `mr_ready` also take
`repoName` = `<root>` and `iid` in its place as the same call. `mr_retry`
keeps `leaseMrUrl: <mr>` either way. `<N>` is the number in `ci_watch`'s
`pipeline.id` (`gitlab:pipeline:N`).

```mermaid
flowchart TB
%% name: watch_ci
    run_open(["Trigger: a watch-ci run is open (own or inherited)"])
    git_branch_current[/git branch --show-current, unless the user named a branch/]
    git_remote_origin[/"git remote get-url origin (watch-ci target)"/]
    target_forge_host{"Forge host (watch-ci target)?"}
    mr_for_branch[/"mr_for_branch {repoName: <root>, branches: [<branch>]}"/]
    gh_pr_list[/gh pr list --head <branch> --json number,url/]
    gate_which_forge
    own_run_identity{"Own run (watch-ci identity)?"}
    run_field_set_branch_mr[/"run_field_set {key: branch, then mr when found, stage: watch-ci}"/]
    mr_found_for_lease{"MR found (watch-ci lease)?"}
    watched_sha_known{"Watched sha known (watch-ci)?"}
    git_ls_remote_sha[/"git ls-remote origin refs/heads/<branch> (the watched sha)"/]
    ci_watch[/"ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}"/]
    ci_watch_state{"ci_watch state (watch-ci)?"}
    run_budget_waiting_results[/"run_budget {key: watch-ci:waiting-results:<sha12>, limit: 5, stage}"/]
    waiting_results_spent{"waiting-results spent (watch-ci)?"}
    end_turn_background_watch
    ci_watch_notification(["Trigger: the ci_watch task notification (watch-ci)"])
    stop_gitlab_ci_shortcut["STOP: GitLab CI goes through ci_watch, the read tools, gitlab_get and mr_retry (watch-ci)"]:::stop
    stop_lease_holder_owns["STOP: the lease holder owns every commit, push and retry (watch-ci)"]:::stop
    stand_down((("Stand down: report the holder, or hand it back (watch-ci)")))
    gate_lease_unavailable
    run_budget_watch_errors[/"run_budget {key: watch-ci:ci-watch-errors:<sha12>, limit: 2, stage}"/]
    watch_errors_spent{"ci-watch-errors spent (watch-ci)?"}
    fix_watch_error
    gate_watch_refused
    run_budget_watch_off_script[/"run_budget {key: watch-ci:ci-watch-off-script, limit: 2, stage}"/]
    watch_off_script_spent{"ci-watch-off-script spent (watch-ci)?"}
    ci_lease_claim_github[/"ci_lease_claim {mrUrl: <mr>, branch} (GitHub)"/]
    github_claim_result{"ci_lease_claim result (GitHub)?"}
    stop_hand_rolled_claim["STOP: claim the lease only with ci_lease_claim (watch-ci)"]:::stop
    run_budget_claim_errors[/"run_budget {key: watch-ci:github-claim-errors, limit: 2, stage}"/]
    claim_errors_spent{"github-claim-errors spent (watch-ci)?"}
    fix_claim_error
    gate_claim_refused
    run_budget_claim_off_script[/"run_budget {key: watch-ci:github-claim-off-script, limit: 2, stage}"/]
    claim_off_script_spent{"github-claim-off-script spent (watch-ci)?"}
    gh_pr_checks[/"gh pr checks <mr> (poll)"/]
    checks_exit_code{"gh pr checks exit (GitHub poll)?"}
    run_budget_polls[/"run_budget {key: watch-ci:github-polls:<sha12>, limit: 46, stage}"/]
    polls_spent{"github-polls spent (watch-ci)?"}
    ci_lease_heartbeat[/"ci_lease_heartbeat {mrUrl} (GitHub poll)"/]
    heartbeat_result{"Heartbeat result (GitHub poll)?"}
    sleep_between_polls[/"sleep 60 as a background Bash task (GitHub poll)"/]
    gh_pr_view_head_sha[/"gh pr view <mr> --json headRefOid (sha guard)"/]
    checks_match_sha{"Checks are for the watched sha (GitHub poll)?"}
    run_budget_sha_waits[/"run_budget {key: watch-ci:github-sha-waits:<sha12>, limit: 6, stage}"/]
    sha_waits_spent{"github-sha-waits spent (watch-ci)?"}
    checks_passed_or_failed{"Checks passed or failed (GitHub poll)?"}
    ci_triage[/"ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}"/]
    ci_triage_result{"ci_triage result (watch-ci)?"}
    stop_gitlab_triage_shortcut["STOP: GitLab triage goes through ci_triage (watch-ci)"]:::stop
    unclear_jobs_present{"UNCLEAR jobs in the report (watch-ci)?"}
    mr_job_trace[/"mr_job_trace {mrUrl: <mr>, jobId, tailLines?, headLines?, grep?} per UNCLEAR job"/]
    classify_triage_report
    classify_failed_jobs
    classify_failing_checks
    only_infra_failures{"Only INFRA blocking failures, none INHERITED (watch-ci)?"}
    run_budget_infra_retries[/"run_budget {key: watch-ci:infra-retries:<sha12>, limit: 2, stage}"/]
    infra_retries_spent{"infra-retries spent (watch-ci)?"}
    retry_forge_host{"Retry on which forge (watch-ci)?"}
    mr_retry[/"mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job"/]
    mr_retry_result{"mr_retry result (watch-ci)?"}
    gate_retry_refused
    run_budget_retry_off_script[/"run_budget {key: watch-ci:retry-off-script, limit: 2, stage}"/]
    retry_off_script_spent{"retry-off-script spent (watch-ci)?"}
    ci_lease_claim_retry[/"ci_lease_claim {mrUrl: <mr>, branch} (GitHub retry)"/]
    reclaim_result{"Re-claim result (GitHub retry)?"}
    gate_reclaim_refused
    gh_run_rerun[/gh run rerun <run-id> --failed/]
    own_run_green{"Own run (watch-ci green)?"}
    draft_forge_host{"Forge host (watch-ci draft check)?"}
    mr_view_draft[/"mr_view {mrUrl: <mr>} (draft check)"/]
    gh_pr_view_draft[/"gh pr view <mr> --json isDraft (draft check)"/]
    mr_still_draft{"MR still a draft (watch-ci)?"}
    gate_mark_ready
    run_budget_mark_ready[/"run_budget {key: watch-ci:mark-ready-iterations, limit: 2, stage}"/]
    mark_ready_spent{"mark-ready-iterations spent (watch-ci)?"}
    mark_ready_forge_host{"Forge host (watch-ci mark-ready)?"}
    mr_ready[/"mr_ready {mrUrl: <mr>}"/]
    gh_pr_ready[/gh pr ready <number>/]
    gate_ci
    run_budget_ci_gate[/"run_budget {key: watch-ci:ci-gate-iterations, limit: 3}"/]
    ci_gate_spent{"ci-gate-iterations spent (watch-ci)?"}
    run_budget_fix_rounds[/"run_budget {key: watch-ci:fix-rounds, limit: 4}"/]
    fix_rounds_spent{"fix-rounds spent (watch-ci)?"}
    fix_real_failure
    mr_found_for_push{"MR found (before git_push)?"}
    git_push_leased[/"git_push {tree: <root>, leaseMrUrl: <mr>}"/]
    git_push_plain[/"git_push {tree: <root>}"/]
    git_push_result{"git_push result (watch-ci)?"}
    stop_shell_push["STOP: push only with git_push (watch-ci)"]:::stop
    gate_push_refused
    confirm_human_push
    push_landed{"Push landed (watch-ci)?"}
    own_run_new_attempt{"Own run (watch-ci new attempt)?"}
    run_resolve_iterate[/"run_resolve {runDb, stage: watch-ci, next: iterate, attempt: <n>, note, decidedBy} (a new attempt)"/]
    new_attempt_result{"run_resolve result (watch-ci new attempt)?"}
    mr_found_for_retry{"MR found (before the retry)?"}
    run_budget_gate_retries[/"run_budget {key: watch-ci:infra-retries:<sha12>, limit: 2, stage} (ci gate retry)"/]
    gate_retries_spent{"infra-retries spent (ci gate retry, watch-ci)?"}
    mr_known_at_exit{"MR known (watch-ci exit)?"}
    ci_lease_release[/"ci_lease_release {mrUrl: <mr>}"/]
    which_exit{"Which exit is this (watch-ci)?"}
    run_close_done[/"run_close {workType: watch-ci, stage: watch-ci, outcome: done}"/]
    run_close_abandoned[/"run_close {workType: watch-ci, stage: watch-ci, outcome: abandoned}"/]
    run_close_failed[/"run_close {workType: watch-ci, stage: watch-ci, outcome: failed, reason}"/]
    run_hold[/"run_hold {stage, reason, decidedBy}"/]
    hand_back_verdict((("Hand the verdict back to the caller (watch-ci)")))
    hand_back_off_script((("Hand the off-script answer back to the caller (watch-ci)")))
    hand_back_failure((("Hand the failure back to the caller (watch-ci)")))
    hand_back_go_back((("Hand the Go back answer back (watch-ci)")))
    held_run_open(((Held in watch-ci: the run stays open)))
    abandoned(((watch-ci run abandoned)))
    failed(((watch-ci failed)))
    done(((watch-ci done))):::done
    run_open --> git_branch_current
    git_branch_current --> git_remote_origin
    git_remote_origin --> target_forge_host
    target_forge_host -->|GitLab, no MR known| mr_for_branch
    target_forge_host -->|GitHub, no PR known| gh_pr_list
    target_forge_host -->|"MR named, handed, or recorded (a resumed run's `mr`)"| own_run_identity
    target_forge_host -->|anything else, nothing handed| gate_which_forge
    gate_which_forge -->|answered: the named forge| target_forge_host
    mr_for_branch -->|a result, null included| own_run_identity
    mr_for_branch -->|error: never read as no MR| gate_ci
    gh_pr_list --> own_run_identity
    own_run_identity -->|yes| run_field_set_branch_mr
    own_run_identity -->|no: inherited| mr_found_for_lease
    run_field_set_branch_mr --> mr_found_for_lease
    mr_found_for_lease -->|yes| watched_sha_known
    mr_found_for_lease -->|no: ship first| gate_ci
    watched_sha_known -->|yes| ci_watch
    watched_sha_known -->|no| git_ls_remote_sha
    git_ls_remote_sha --> ci_watch
    ci_watch --> ci_watch_state
    ci_watch_state -->|running| ci_watch
    ci_watch_state -->|waiting| run_budget_waiting_results
    run_budget_waiting_results --> waiting_results_spent
    waiting_results_spent -->|no| ci_watch
    waiting_results_spent -->|yes: quote its next| gate_ci
    ci_watch_state -->|backgrounded| end_turn_background_watch
    end_turn_background_watch -.-> ci_watch_notification
    ci_watch_notification --> ci_watch_state
    ci_watch_state -->|success or success_with_warnings| own_run_green
    ci_watch_state -->|failed| ci_triage
    ci_watch_state -->|timeout, no_pipeline, canceled, skipped, manual, superseded or aborted| gate_ci
    ci_watch_state -->|stood_down, holder named| stop_lease_holder_owns
    ci_watch_state -->|lease_unavailable| gate_lease_unavailable
    ci_watch_state -->|unsupported_forge: a GitHub PR| ci_lease_claim_github
    ci_watch_state -->|tool error| run_budget_watch_errors
    ci_watch_state -->|tempted to watch with a script or the GitLab CLI| stop_gitlab_ci_shortcut
    stop_gitlab_ci_shortcut --> ci_watch
    stop_lease_holder_owns --> stand_down
    gate_lease_unavailable -->|take, hold or hand back| mr_known_at_exit
    gate_lease_unavailable -->|iterate: watch again| ci_watch
    run_budget_watch_errors --> watch_errors_spent
    watch_errors_spent -->|no| fix_watch_error
    watch_errors_spent -->|yes| gate_watch_refused
    fix_watch_error --> ci_watch
    gate_watch_refused -->|take: green for the watched sha| own_run_green
    gate_watch_refused -->|take: red, or not for the watched sha| gate_ci
    gate_watch_refused -->|iterate| run_budget_watch_off_script
    gate_watch_refused -->|hold or hand back| mr_known_at_exit
    run_budget_watch_off_script --> watch_off_script_spent
    watch_off_script_spent -->|no: watch again| ci_watch
    watch_off_script_spent -->|yes: fail| mr_known_at_exit
    ci_lease_claim_github --> github_claim_result
    github_claim_result -->|claimed: true| gh_pr_checks
    github_claim_result -->|claimed: false, holder named| stop_lease_holder_owns
    github_claim_result -->|tool error| run_budget_claim_errors
    github_claim_result -->|tempted to write the lease by hand or with a script| stop_hand_rolled_claim
    stop_hand_rolled_claim --> ci_lease_claim_github
    run_budget_claim_errors --> claim_errors_spent
    claim_errors_spent -->|no| fix_claim_error
    claim_errors_spent -->|yes| gate_claim_refused
    fix_claim_error --> ci_lease_claim_github
    gate_claim_refused -->|take, hold or hand back| mr_known_at_exit
    gate_claim_refused -->|iterate| run_budget_claim_off_script
    run_budget_claim_off_script --> claim_off_script_spent
    claim_off_script_spent -->|no: claim again| ci_lease_claim_github
    claim_off_script_spent -->|yes: fail| mr_known_at_exit
    gh_pr_checks --> checks_exit_code
    checks_exit_code -->|0, or non-8 exit with checks reported| gh_pr_view_head_sha
    checks_exit_code -->|8, or no checks reported: pending| run_budget_polls
    run_budget_polls --> polls_spent
    polls_spent -->|no| ci_lease_heartbeat
    polls_spent -->|yes: timeout| gate_ci
    ci_lease_heartbeat --> heartbeat_result
    heartbeat_result -->|ok: true| sleep_between_polls
    heartbeat_result -->|lost| stop_lease_holder_owns
    heartbeat_result -->|none: claim it again| ci_lease_claim_github
    heartbeat_result -->|tool error| gate_ci
    sleep_between_polls --> gh_pr_checks
    gh_pr_view_head_sha --> checks_match_sha
    checks_match_sha -->|yes| checks_passed_or_failed
    checks_match_sha -->|no| run_budget_sha_waits
    run_budget_sha_waits --> sha_waits_spent
    sha_waits_spent -->|no: wait for the watched sha| sleep_between_polls
    sha_waits_spent -->|yes: no checks for the watched sha| gate_ci
    checks_passed_or_failed -->|passed| own_run_green
    checks_passed_or_failed -->|failed| classify_failing_checks
    classify_failing_checks --> only_infra_failures
    ci_triage --> ci_triage_result
    ci_triage_result -->|triaged| unclear_jobs_present
    ci_triage_result -->|tool error: quote it| classify_failed_jobs
    ci_triage_result -->|tempted to run the vendored triage script| stop_gitlab_triage_shortcut
    stop_gitlab_triage_shortcut --> ci_triage
    unclear_jobs_present -->|yes| mr_job_trace
    unclear_jobs_present -->|no| classify_triage_report
    mr_job_trace --> classify_triage_report
    classify_triage_report --> only_infra_failures
    classify_failed_jobs --> only_infra_failures
    only_infra_failures -->|yes| run_budget_infra_retries
    only_infra_failures -->|no: a REAL, UNCLEAR or INHERITED failure| gate_ci
    run_budget_infra_retries --> infra_retries_spent
    infra_retries_spent -->|no: retry once| retry_forge_host
    infra_retries_spent -->|yes: retried already| gate_ci
    retry_forge_host -->|GitLab| mr_retry
    retry_forge_host -->|GitHub| ci_lease_claim_retry
    mr_retry --> mr_retry_result
    mr_retry_result -->|retried: watch again| ci_watch
    mr_retry_result -->|refused: lease_held, holder named| stop_lease_holder_owns
    mr_retry_result -->|tool error| gate_retry_refused
    gate_retry_refused -->|take: human retried| ci_watch
    gate_retry_refused -->|iterate| run_budget_retry_off_script
    gate_retry_refused -->|hold or hand back| mr_known_at_exit
    run_budget_retry_off_script --> retry_off_script_spent
    retry_off_script_spent -->|no: retry again| retry_forge_host
    retry_off_script_spent -->|yes: fail| mr_known_at_exit
    ci_lease_claim_retry --> reclaim_result
    reclaim_result -->|claimed: true| gh_run_rerun
    reclaim_result -->|claimed: false, holder named| stop_lease_holder_owns
    reclaim_result -->|tool error| gate_reclaim_refused
    gate_reclaim_refused -->|take: human reran| gh_pr_checks
    gate_reclaim_refused -->|iterate| run_budget_retry_off_script
    gate_reclaim_refused -->|hold or hand back| mr_known_at_exit
    gh_run_rerun --> gh_pr_checks
    own_run_green -->|yes| draft_forge_host
    own_run_green -->|no: inherited| mr_known_at_exit
    draft_forge_host -->|GitLab| mr_view_draft
    draft_forge_host -->|GitHub| gh_pr_view_draft
    mr_view_draft --> mr_still_draft
    gh_pr_view_draft --> mr_still_draft
    mr_still_draft -->|yes| gate_mark_ready
    mr_still_draft -->|no| mr_known_at_exit
    gate_mark_ready -->|mark ready now| mark_ready_forge_host
    gate_mark_ready -->|keep it draft, go back or hold| mr_known_at_exit
    gate_mark_ready -->|iterate| run_budget_mark_ready
    run_budget_mark_ready --> mark_ready_spent
    mark_ready_spent -->|no: reopen with their note| gate_mark_ready
    mark_ready_spent -->|yes: keep it draft| mr_known_at_exit
    mark_ready_forge_host -->|GitLab| mr_ready
    mark_ready_forge_host -->|GitHub| gh_pr_ready
    mr_ready --> mr_known_at_exit
    gh_pr_ready --> mr_known_at_exit
    gate_ci -->|fix and re-push| run_budget_fix_rounds
    gate_ci -->|retry the job| mr_found_for_retry
    gate_ci -->|hand back, abandon or hold| mr_known_at_exit
    gate_ci -->|iterate| run_budget_ci_gate
    run_budget_ci_gate --> ci_gate_spent
    ci_gate_spent -->|no: re-triage with their note| gate_ci
    ci_gate_spent -->|yes: hand back| mr_known_at_exit
    run_budget_fix_rounds --> fix_rounds_spent
    fix_rounds_spent -->|no| fix_real_failure
    fix_rounds_spent -->|yes: reopen, Hand back recommended| run_budget_ci_gate
    fix_real_failure --> mr_found_for_push
    mr_found_for_push -->|yes| git_push_leased
    mr_found_for_push -->|no: no lease| git_push_plain
    git_push_leased --> git_push_result
    git_push_plain --> git_push_result
    git_push_result -->|ok: watch its sha| own_run_new_attempt
    git_push_result -->|refused: lease_held, holder named| stop_lease_holder_owns
    git_push_result -->|any other error or refusal| stop_shell_push
    stop_shell_push --> gate_push_refused
    gate_push_refused -->|take: the human pushed| confirm_human_push
    gate_push_refused -->|iterate: push again| mr_found_for_push
    gate_push_refused -->|hand back or hold| mr_known_at_exit
    confirm_human_push --> push_landed
    push_landed -->|yes: the remote carries HEAD| own_run_new_attempt
    push_landed -->|no: reopen with the comparison| gate_push_refused
    own_run_new_attempt -->|yes| run_resolve_iterate
    own_run_new_attempt -->|no: inherited| mr_found_for_lease
    run_resolve_iterate --> new_attempt_result
    new_attempt_result -->|applied: iterate, repeated or not| mr_found_for_lease
    new_attempt_result -->|refused: fail, quoting it| mr_known_at_exit
    mr_found_for_retry -->|yes| run_budget_gate_retries
    mr_found_for_retry -->|no: nothing to retry| run_budget_ci_gate
    run_budget_gate_retries --> gate_retries_spent
    gate_retries_spent -->|no| retry_forge_host
    gate_retries_spent -->|yes: reopen| run_budget_ci_gate
    mr_known_at_exit -->|yes| ci_lease_release
    mr_known_at_exit -->|no| which_exit
    ci_lease_release --> which_exit
    which_exit -->|own run: green, a ci Hand back, or an attending Take| run_close_done
    which_exit -->|own run: abandon| run_close_abandoned
    which_exit -->|own run: a failure or an off-script hand back| run_close_failed
    which_exit -->|inherited: green, or red after a ci Hand back| hand_back_verdict
    which_exit -->|inherited: an off-script take or hand back| hand_back_off_script
    which_exit -->|inherited: a failure| hand_back_failure
    which_exit -->|inherited: go back| hand_back_go_back
    which_exit -->|hold| run_hold
    run_close_done --> done
    run_close_abandoned --> abandoned
    run_close_failed --> failed
    run_hold --> held_run_open
```
