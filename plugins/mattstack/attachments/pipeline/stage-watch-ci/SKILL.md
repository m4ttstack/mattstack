---
name: stage-watch-ci
description: "Pipeline stage: watch the pipeline the ship stage triggered and triage a red result. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: watch-ci-domain@1, required: false }
  forge: { contract: ci-forge@1, required: false }
metadata:
  stage: "watch-ci"
  stage-consumes: "mr branch"
  stage-produces: "ci"
---

# stage: watch-ci

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read the consumes and `pushed` with
`run_field_get`; every `stage` argument is `"watch-ci"`. Write `ci` once a
verdict exists; a failure's `detailPath` is the triage report.

`<mr>` is `mr`'s https URL. Every CI tool, `mr_view` and `mr_ready` take
`mrUrl: <mr>`, the form the graph shows. When this worktree is a checkout
of the MR's project, `ci_watch`, `ci_triage`, `pipeline_jobs`,
`mr_job_trace`, `mr_retry`, `mr_view` and `mr_ready` also take
`repoName` = its absolute path and the iid in `mr` in its place as the
same call. `mr_retry` keeps `leaseMrUrl: <mr>` either way. `<N>` is the
number in `ci_watch`'s `pipeline.id` (`gitlab:pipeline:N`).

```dot
digraph watch_ci {
    watch_ci_entered [label="Watch-ci stage entered" shape=ellipse];
    run_field_get_mr [label="run_field_get {key: mr}" shape=plaintext];
    run_field_get_branch [label="run_field_get {key: branch}" shape=plaintext];
    mr_set [label="mr set?" shape=diamond];
    run_field_get_pushed [label="run_field_get {key: pushed}" shape=plaintext];
    git_rev_parse_head [label="git rev-parse HEAD (the pushed sha)" shape=plaintext];
    pushed_sha_is_head [label="pushed set, and its sha is HEAD?" shape=diamond];

    ci_watch [label="ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" shape=plaintext];
    ci_watch_state [label="ci_watch state?" shape=diamond];
    run_budget_waiting_results [label="run_budget {key: watch-ci:waiting-results:<sha12>, limit: 5, stage}" shape=plaintext];
    waiting_results_spent [label="waiting-results spent?" shape=diamond];
    end_turn_background_watch [label="End the turn: ci_watch runs in the background" shape=box];
    ci_watch_notification [label="Trigger: the ci_watch task notification" shape=ellipse];
    stop_gitlab_ci_shortcut [label="STOP: GitLab CI goes through ci_watch, the read tools, gitlab_get and mr_retry" shape=octagon style=filled fillcolor=red fontcolor=white];
    stop_lease_holder_owns [label="STOP: the lease holder owns every commit, push and retry" shape=octagon style=filled fillcolor=red fontcolor=white];
    stand_down [label="Stand down: report the holder and stop" shape=doublecircle];
    gate_lease_unavailable [label="Off-script gate: lease_unavailable" shape=box];
    run_budget_watch_errors [label="run_budget {key: watch-ci:ci-watch-errors:<sha12>, limit: 2, stage}" shape=plaintext];
    watch_errors_spent [label="ci-watch-errors spent?" shape=diamond];
    fix_watch_error [label="Fix what the ci_watch error names" shape=box];
    gate_watch_refused [label="Off-script gate: ci_watch refused" shape=box];
    run_budget_watch_off_script [label="run_budget {key: watch-ci:ci-watch-off-script, limit: 2, stage}" shape=plaintext];
    watch_off_script_spent [label="ci-watch-off-script spent?" shape=diamond];

    ci_lease_claim_github [label="ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" shape=plaintext];
    github_claim_result [label="Claim result (GitHub)?" shape=diamond];
    stop_hand_rolled_claim [label="STOP: claim the lease only with ci_lease_claim" shape=octagon style=filled fillcolor=red fontcolor=white];
    run_budget_claim_errors [label="run_budget {key: watch-ci:github-claim-errors, limit: 2, stage}" shape=plaintext];
    claim_errors_spent [label="github-claim-errors spent?" shape=diamond];
    fix_claim_error [label="Fix what the claim error names (GitHub)" shape=box];
    gate_claim_refused [label="Off-script gate: ci_lease_claim refused (GitHub)" shape=box];
    run_budget_claim_off_script [label="run_budget {key: watch-ci:github-claim-off-script, limit: 2, stage}" shape=plaintext];
    claim_off_script_spent [label="github-claim-off-script spent?" shape=diamond];
    gh_pr_checks [label="gh pr checks <mr>" shape=plaintext];
    checks_exit_code [label="gh pr checks exit?" shape=diamond];
    run_budget_polls [label="run_budget {key: watch-ci:github-polls:<sha12>, limit: 46, stage}" shape=plaintext];
    polls_spent [label="github-polls spent?" shape=diamond];
    ci_lease_heartbeat [label="ci_lease_heartbeat {mrUrl: <mr>}" shape=plaintext];
    heartbeat_result [label="Heartbeat result?" shape=diamond];
    sleep_between_polls [label="sleep 60 as a background Bash task" shape=plaintext];
    gh_pr_view_head_sha [label="gh pr view <mr> --json headRefOid" shape=plaintext];
    checks_match_sha [label="Checks are for the pushed sha?" shape=diamond];
    run_budget_sha_waits [label="run_budget {key: watch-ci:github-sha-waits:<sha12>, limit: 6, stage}" shape=plaintext];
    sha_waits_spent [label="github-sha-waits spent?" shape=diamond];
    checks_passed_or_failed [label="Checks passed or failed?" shape=diamond];
    classify_failing_checks [label="Classify each failing check REAL or INFRA" shape=box];

    ci_triage [label="ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}" shape=plaintext];
    ci_triage_result [label="ci_triage result?" shape=diamond];
    stop_gitlab_triage_shortcut [label="STOP: GitLab triage goes through ci_triage" shape=octagon style=filled fillcolor=red fontcolor=white];
    unclear_jobs_present [label="UNCLEAR jobs in the report?" shape=diamond];
    mr_job_trace [label="mr_job_trace {mrUrl: <mr>, jobId, tailLines?, headLines?, grep?} per UNCLEAR job" shape=plaintext];
    classify_triage_report [label="Classify the triage report" shape=box];
    classify_failed_jobs [label="Classify each failure REAL or INFRA from failedJobs" shape=box];
    only_infra_failures [label="Only INFRA blocking failures, none INHERITED?" shape=diamond];
    run_budget_infra_retries [label="run_budget {key: watch-ci:infra-retries:<sha12>, limit: 2, stage}" shape=plaintext];
    infra_retries_spent [label="infra-retries spent?" shape=diamond];

    retry_forge_host [label="Retry on which forge?" shape=diamond];
    mr_retry [label="mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job" shape=plaintext];
    mr_retry_result [label="mr_retry result?" shape=diamond];
    gate_retry_refused [label="Off-script gate: mr_retry refused" shape=box];
    run_budget_retry_off_script [label="run_budget {key: watch-ci:retry-off-script, limit: 2, stage}" shape=plaintext];
    retry_off_script_spent [label="retry-off-script spent?" shape=diamond];
    ci_lease_claim_retry [label="ci_lease_claim {mrUrl: <mr>, branch} (GitHub retry)" shape=plaintext];
    reclaim_result [label="Re-claim result (GitHub retry)?" shape=diamond];
    gate_reclaim_refused [label="Off-script gate: GitHub retry claim refused" shape=box];
    gh_run_rerun [label="gh run rerun <run-id> --failed" shape=plaintext];

    gate_ci [label="Gate ci" shape=box];
    run_budget_ci_gate [label="run_budget {key: watch-ci:ci-gate-iterations, limit: 3, stage}" shape=plaintext];
    ci_gate_spent [label="ci-gate-iterations spent?" shape=diamond];
    mr_known_for_retry [label="MR known (before the retry)?" shape=diamond];
    run_budget_gate_retries [label="run_budget {key: watch-ci:infra-retries:<sha12>, limit: 2, stage} (ci gate retry)" shape=plaintext];
    gate_retries_spent [label="infra-retries spent (ci gate retry)?" shape=diamond];
    run_field_set_ci_red [label="run_field_set {key: ci, value: red: <triage>, stage}" shape=plaintext];
    run_status_abandoned [label="run_status {status: abandoned}" shape=plaintext];
    draft_forge_host [label="Forge host (draft check)?" shape=diamond];
    mr_view [label="mr_view {mrUrl: <mr>}" shape=plaintext];
    gh_pr_view_draft [label="gh pr view <mr> --json isDraft" shape=plaintext];
    mr_still_draft [label="MR still a draft?" shape=diamond];
    gate_mark_ready [label="Gate mark-ready" shape=box];
    run_budget_mark_ready [label="run_budget {key: watch-ci:mark-ready-iterations, limit: 2, stage}" shape=plaintext];
    mark_ready_spent [label="mark-ready-iterations spent?" shape=diamond];
    mark_ready_forge_host [label="Forge host (mark-ready)?" shape=diamond];
    mr_ready [label="mr_ready {mrUrl: <mr>}" shape=plaintext];
    gh_pr_ready [label="gh pr ready <number>" shape=plaintext];
    run_field_set_ci_green [label="run_field_set {key: ci, value: green, stage}" shape=plaintext];
    mr_known_at_exit [label="MR known (exit)?" shape=diamond];
    ci_lease_release [label="ci_lease_release {mrUrl: <mr>}" shape=plaintext];
    which_exit [label="Which exit is this?" shape=diamond];
    run_stage_fail [label="run_stage {action: fail, stage, reason, detailPath?}" shape=plaintext];
    run_hold [label="run_hold {stage, reason, decidedBy}" shape=plaintext];
    stage_failed [label="Stage failed" shape=doublecircle];
    hand_back_redirect [label="Hand Fix and re-push to the orchestrator: Redirect to implement" shape=doublecircle];
    hand_back_go_back [label="Hand the Go back answer to the orchestrator" shape=doublecircle];
    held_end_turn [label="Held: end the turn naming run and stage" shape=doublecircle];
    run_abandoned [label="Run abandoned" shape=doublecircle];
    watch_ci_done [label="Watch-ci done: return to the orchestrator" shape=doublecircle style=filled fillcolor=lightgreen];

    watch_ci_entered -> run_field_get_mr;
    run_field_get_mr -> run_field_get_branch;
    run_field_get_branch -> mr_set;
    mr_set -> run_field_get_pushed [label="yes"];
    mr_set -> gate_ci [label="no: ship first"];
    run_field_get_pushed -> git_rev_parse_head;
    git_rev_parse_head -> pushed_sha_is_head;
    pushed_sha_is_head -> ci_watch [label="yes: its sha and non-null priorPipelineId"];
    pushed_sha_is_head -> ci_watch [label="no or unreadable: HEAD, no prior id"];

    ci_watch -> ci_watch_state;
    ci_watch_state -> ci_watch [label="running"];
    ci_watch_state -> run_budget_waiting_results [label="waiting"];
    run_budget_waiting_results -> waiting_results_spent;
    waiting_results_spent -> ci_watch [label="no"];
    waiting_results_spent -> gate_ci [label="yes: quote its next"];
    ci_watch_state -> end_turn_background_watch [label="backgrounded"];
    end_turn_background_watch -> ci_watch_notification [style=dashed];
    ci_watch_notification -> ci_watch_state;
    ci_watch_state -> draft_forge_host [label="success or success_with_warnings"];
    ci_watch_state -> ci_triage [label="failed"];
    ci_watch_state -> gate_ci [label="timeout, no_pipeline, canceled, skipped, manual, superseded or aborted"];
    ci_watch_state -> stop_lease_holder_owns [label="stood_down, holder named"];
    ci_watch_state -> gate_lease_unavailable [label="lease_unavailable"];
    ci_watch_state -> ci_lease_claim_github [label="unsupported_forge: GitHub"];
    ci_watch_state -> run_budget_watch_errors [label="tool error"];
    ci_watch_state -> stop_gitlab_ci_shortcut [label="tempted to watch with a script or the GitLab CLI"];
    stop_gitlab_ci_shortcut -> ci_watch;
    stop_lease_holder_owns -> stand_down;

    gate_lease_unavailable -> run_field_set_ci_red [label="take: human attends"];
    gate_lease_unavailable -> ci_watch [label="iterate: watch again"];
    gate_lease_unavailable -> mr_known_at_exit [label="hold or hand back"];

    run_budget_watch_errors -> watch_errors_spent;
    watch_errors_spent -> fix_watch_error [label="no"];
    watch_errors_spent -> gate_watch_refused [label="yes"];
    fix_watch_error -> ci_watch;
    gate_watch_refused -> draft_forge_host [label="take: green for the pushed sha"];
    gate_watch_refused -> gate_ci [label="take: red, or another sha"];
    gate_watch_refused -> run_budget_watch_off_script [label="iterate"];
    gate_watch_refused -> mr_known_at_exit [label="hold or hand back"];
    run_budget_watch_off_script -> watch_off_script_spent;
    watch_off_script_spent -> ci_watch [label="no: watch again"];
    watch_off_script_spent -> mr_known_at_exit [label="yes: fail"];

    ci_lease_claim_github -> github_claim_result;
    github_claim_result -> gh_pr_checks [label="claimed: true"];
    github_claim_result -> stop_lease_holder_owns [label="claimed: false, holder named"];
    github_claim_result -> run_budget_claim_errors [label="tool error"];
    github_claim_result -> stop_hand_rolled_claim [label="tempted to write the lease by hand"];
    stop_hand_rolled_claim -> ci_lease_claim_github;
    run_budget_claim_errors -> claim_errors_spent;
    claim_errors_spent -> fix_claim_error [label="no"];
    claim_errors_spent -> gate_claim_refused [label="yes"];
    fix_claim_error -> ci_lease_claim_github;
    gate_claim_refused -> run_field_set_ci_red [label="take: human attends"];
    gate_claim_refused -> run_budget_claim_off_script [label="iterate"];
    gate_claim_refused -> mr_known_at_exit [label="hold or hand back"];
    run_budget_claim_off_script -> claim_off_script_spent;
    claim_off_script_spent -> ci_lease_claim_github [label="no: claim again"];
    claim_off_script_spent -> mr_known_at_exit [label="yes: fail"];

    gh_pr_checks -> checks_exit_code;
    checks_exit_code -> gh_pr_view_head_sha [label="0, or non-8 exit with checks reported"];
    checks_exit_code -> run_budget_polls [label="8, or no checks reported: pending"];
    run_budget_polls -> polls_spent;
    polls_spent -> ci_lease_heartbeat [label="no"];
    polls_spent -> gate_ci [label="yes: timeout"];
    ci_lease_heartbeat -> heartbeat_result;
    heartbeat_result -> sleep_between_polls [label="ok: true"];
    heartbeat_result -> stop_lease_holder_owns [label="lost"];
    heartbeat_result -> ci_lease_claim_github [label="none: claim it again"];
    heartbeat_result -> gate_ci [label="tool error"];
    sleep_between_polls -> gh_pr_checks;
    gh_pr_view_head_sha -> checks_match_sha;
    checks_match_sha -> checks_passed_or_failed [label="yes"];
    checks_match_sha -> run_budget_sha_waits [label="no"];
    run_budget_sha_waits -> sha_waits_spent;
    sha_waits_spent -> sleep_between_polls [label="no: wait"];
    sha_waits_spent -> gate_ci [label="yes: no checks for the sha"];
    checks_passed_or_failed -> draft_forge_host [label="passed"];
    checks_passed_or_failed -> classify_failing_checks [label="failed"];
    classify_failing_checks -> only_infra_failures;

    ci_triage -> ci_triage_result;
    ci_triage_result -> unclear_jobs_present [label="triaged"];
    ci_triage_result -> classify_failed_jobs [label="tool error: quote it"];
    ci_triage_result -> stop_gitlab_triage_shortcut [label="tempted to run the vendored triage script"];
    stop_gitlab_triage_shortcut -> ci_triage;
    unclear_jobs_present -> mr_job_trace [label="yes"];
    unclear_jobs_present -> classify_triage_report [label="no"];
    mr_job_trace -> classify_triage_report;
    classify_triage_report -> only_infra_failures;
    classify_failed_jobs -> only_infra_failures;
    only_infra_failures -> run_budget_infra_retries [label="yes"];
    only_infra_failures -> gate_ci [label="no: REAL, UNCLEAR or INHERITED"];
    run_budget_infra_retries -> infra_retries_spent;
    infra_retries_spent -> retry_forge_host [label="no: retry once"];
    infra_retries_spent -> gate_ci [label="yes: retried already"];

    retry_forge_host -> mr_retry [label="GitLab"];
    retry_forge_host -> ci_lease_claim_retry [label="GitHub"];
    mr_retry -> mr_retry_result;
    mr_retry_result -> ci_watch [label="retried: watch again"];
    mr_retry_result -> stop_lease_holder_owns [label="refused: lease_held, holder named"];
    mr_retry_result -> gate_retry_refused [label="tool error"];
    gate_retry_refused -> ci_watch [label="take: human retried"];
    gate_retry_refused -> run_budget_retry_off_script [label="iterate"];
    gate_retry_refused -> mr_known_at_exit [label="hold or hand back"];
    run_budget_retry_off_script -> retry_off_script_spent;
    retry_off_script_spent -> retry_forge_host [label="no: retry again"];
    retry_off_script_spent -> mr_known_at_exit [label="yes: fail"];
    ci_lease_claim_retry -> reclaim_result;
    reclaim_result -> gh_run_rerun [label="claimed: true"];
    reclaim_result -> stop_lease_holder_owns [label="claimed: false, holder named"];
    reclaim_result -> gate_reclaim_refused [label="tool error"];
    gate_reclaim_refused -> gh_pr_checks [label="take: human reran"];
    gate_reclaim_refused -> run_budget_retry_off_script [label="iterate"];
    gate_reclaim_refused -> mr_known_at_exit [label="hold or hand back"];
    gh_run_rerun -> gh_pr_checks;

    gate_ci -> hand_back_redirect [label="fix and re-push: no ci, lease kept"];
    gate_ci -> mr_known_for_retry [label="retry the job"];
    gate_ci -> run_field_set_ci_red [label="hand back"];
    gate_ci -> mr_known_at_exit [label="abandon, go back or hold"];
    gate_ci -> run_budget_ci_gate [label="iterate"];
    run_budget_ci_gate -> ci_gate_spent;
    ci_gate_spent -> gate_ci [label="no: re-triage with their note"];
    ci_gate_spent -> run_field_set_ci_red [label="yes: hand back"];
    mr_known_for_retry -> run_budget_gate_retries [label="yes"];
    mr_known_for_retry -> run_budget_ci_gate [label="no: nothing to retry"];
    run_budget_gate_retries -> gate_retries_spent;
    gate_retries_spent -> retry_forge_host [label="no"];
    gate_retries_spent -> run_budget_ci_gate [label="yes: reopen"];
    run_status_abandoned -> run_abandoned;

    draft_forge_host -> mr_view [label="GitLab"];
    draft_forge_host -> gh_pr_view_draft [label="GitHub"];
    draft_forge_host -> run_field_set_ci_green [label="anything else"];
    mr_view -> mr_still_draft;
    gh_pr_view_draft -> mr_still_draft;
    mr_still_draft -> gate_mark_ready [label="yes"];
    mr_still_draft -> run_field_set_ci_green [label="no"];
    gate_mark_ready -> mark_ready_forge_host [label="mark ready now"];
    gate_mark_ready -> run_field_set_ci_green [label="keep it draft"];
    gate_mark_ready -> mr_known_at_exit [label="go back or hold"];
    gate_mark_ready -> run_budget_mark_ready [label="iterate"];
    run_budget_mark_ready -> mark_ready_spent;
    mark_ready_spent -> gate_mark_ready [label="no: reopen with their note"];
    mark_ready_spent -> run_field_set_ci_green [label="yes: keep it draft"];
    mark_ready_forge_host -> mr_ready [label="GitLab"];
    mark_ready_forge_host -> gh_pr_ready [label="GitHub"];
    mr_ready -> run_field_set_ci_green;
    gh_pr_ready -> run_field_set_ci_green;
    run_field_set_ci_green -> mr_known_at_exit;
    run_field_set_ci_red -> mr_known_at_exit;

    mr_known_at_exit -> ci_lease_release [label="yes"];
    mr_known_at_exit -> which_exit [label="no"];
    ci_lease_release -> which_exit;
    which_exit -> watch_ci_done [label="ci written"];
    which_exit -> run_hold [label="hold"];
    which_exit -> hand_back_go_back [label="go back"];
    which_exit -> run_status_abandoned [label="abandon"];
    which_exit -> run_stage_fail [label="a failure or off-script hand back"];
    run_hold -> held_end_turn;
    run_stage_fail -> stage_failed;
}
```

### End the turn: ci_watch runs in the background

A `ci_watch` still running after 120 s moves to the background; its
`<task-notification>` `<result>` is the next `ci_watch state`. End the
turn in one line: `watching CI in the background (task <id>)`. The stop
hook lets the turn end while the task is pending, and a message meanwhile
reaches you at once; a foreground wait (`sleep`, a polling script, a
second `ci_watch`) delays both.

### The off-script gates

Each is the gate protocol's Off-script gate (scope
`off-script:watch-ci:<n>`, `context` quoting the refusal): `action`
**Take** (the move its section names) / **Hand back** (a failure, the
refusal its reason); `next` **Proceed** (Recommended) / **Iterate
here** (the human fixed it) / **Hold**. A spent Iterate budget fails,
quoting the refusals. An attending Take writes `ci` red,
the refusal as its triage line.

### Off-script gate: lease_unavailable

`ci_watch` could not claim or keep the lease after its own re-claims
(`error` says why); no one else holds it: no stand-down. Take:
the human attends the MR. No budget: another `lease_unavailable` reopens
this gate.

### Fix what the ci_watch error names

Correct what the error names (`mrUrl` the MR's https URL, `sha` 7 to 40 hex
characters, `priorPipelineId` the `N` of `gitlab:pipeline:N`) and call
again, once; an error naming no input (the repo not registered with rt,
`mr` on no known forge) gets one unchanged call.

### Off-script gate: ci_watch refused

`context` quotes both errors. Take: the human reports green or red for the
pushed sha.

### Fix what the claim error names (GitHub)

Correct what the error names (`mrUrl` the PR's `.../pull/<n>` URL, `branch`
its source branch) and claim again, once; an error naming no input (no
session id) gets one unchanged claim.

### Off-script gate: ci_lease_claim refused (GitHub)

`context` quotes both errors. Take: the human attends the PR.

### Classify the triage report

`ci_triage` sorts failed jobs into REAL, INFRA or UNCLEAR by their logs and
marks each blocking one `yours`, INHERITED (failing on the target branch
too) or UNKNOWN (no base); the `blocking` list decides the verdict. Read
each UNCLEAR job with `mr_job_trace`: the tail, then `grep` or
`headLines`; a teardown-only tail (cleanup, artifact upload, runner exit)
says nothing. Read a `crossProject` entry as the failedJobs section says.
Each blocking failure is then REAL (the change broke it: a test, type or
lint failure in touched code), INFRA (unrelated: a runner, network or
dependency outage, a known flake) or, still UNCLEAR, the gate's.

No failure is classified before its log is read; an unreadable trace is
UNCLEAR, never INFRA. INHERITED goes to the gate, named, never retried or
fixed here; UNKNOWN still gets its one INFRA retry. This box only
classifies: no retry command a report prints is run.

### Classify each failure REAL or INFRA from failedJobs

`ci_triage` errored: quote it and classify `ci_watch`'s `failedJobs` as the
triage-report section says, ownership unknown, reading a job with no
`traceTail` (past the first five blocking) or a short or teardown-only
tail with `mr_job_trace`.

`failedJobs` lists same-project downstream jobs, so an empty list on a
`failed` pipeline likely means a cross-project one: read
`projects/:id/pipelines/<pipelineId>/bridges` with `gitlab_get`, its jobs,
then `projects/<downstream project id>/jobs/<jobId>/trace` (`mr_job_trace`
reads only this project). `gitlab_get` returns at most 256 KiB, so a log
whose end is out of reach stays UNCLEAR. Other pipelines come from
`pipeline_list`, a pipeline's jobs from `pipeline_jobs`.

### Classify each failing check REAL or INFRA

Read the failing checks' logs from the links `gh pr checks <mr>` prints;
classify as the triage-report section says, ownership unknown.

### Off-script gate: mr_retry refused

`mr_retry` errored (`lease_held` is the stand-down); `context` quotes the
error and job ids. Take: the human retried the job.

### Off-script gate: GitHub retry claim refused

The re-claim before `gh run rerun` errored. Take: the human reran the job.

### Reading a GitLab fact no read tool returns

Read it with `gitlab_get {mrUrl: <mr>, path}` (`path` from the API root,
`:id` for this project: `projects/:id/jobs/<jobId>`), part of the step, not
off-script.
Quote a GitLab error as written; a refused credential path is final.

### Gate ci

Quote any error, or a spent `waiting`'s `next`. On `no_pipeline`,
`pushed: false` means the MR head is `remoteSha`: say ship first; `pushed:
true` means no pipeline ran for it. Scope `ci:watch-ci:<attempt>`. One sentence above the form: the
verdict and a one-line triage per blocking failure.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `action` (write-in) | **Fix and re-push** (a REAL failure in your change) / **Retry the job** (a flake not yet retried) / **Hand back** (leave it red for the human) / **Abandon the run** | always |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage; with one candidate, **Go back to `<stage>`** in `next` instead | Go back, with more than one earlier stage row |

Mark one `action` option `(Recommended)`: **Fix and re-push** when any
blocking failure is REAL, while this is the first or second `watch-ci`
attempt (the `<attempt>` in scope `ci:watch-ci:<attempt>`); else **Hand
back** when any is REAL; else **Retry the job** when an INFRA one is not
yet retried; else **Hand back**, which also covers a red with no triage
(a timeout, `no_pipeline`, an MR lookup error).

Selection: `{"action":"fix|retry|handback|abandon","next":"proceed|iterate|go-back|hold","to":"<stage or null>","note":"<their words or null>"}`.
An `action` write-in records `{"writeIn": "<their words>"}` as `action`.
Read `next` first: Proceed applies `action`; Iterate here, Go back and
Hold win over it.

### Gate mark-ready

One sentence above the form: CI is green for the MR's head, and whether
`evidence` is set.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `ready` (write-in) | **Mark ready now (Recommended)** (when `evidence` is set and not `-`) / **Keep it draft** | always |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage | Go back, with more than one earlier stage row |

Selection: `{"ready":true|false,"next":"proceed|iterate|go-back|hold","to":"<stage or null>","note":"<their words or null>"}`.

## What the graph cannot show

- **The pushed sha.** The ship stage writes `pushed` = `{"sha",
  "priorPipelineId"}`; `<sha12>` is the sha's first 12 characters.
  A `priorPipelineId` a result carries goes on the next call; the watched
  pipeline's own `pipeline.id` never does. Both `pushed set` edges say what to pass.
- **The watch window.** `ci_watch` owns `timeout`
  (`ci.watch.budgetMinutes`) and `no_pipeline` (10 minutes with no pipeline,
  or one proved not this commit's): pass no budget arguments. An unprovable
  `waiting` (a merge train with no prior id, an unread commit) gets neither:
  `waiting-results` counts it.
- **The sha guard.** `ci_watch` counts only a pipeline for `sha` and
  returns `superseded` when the head moves on. On GitHub `headRefOid` must equal it, "no checks reported" is
  pending, and `gh run rerun` takes the run id from the failed check's link.
- **Hold.** `run_hold` takes the gate as `reason` and `decidedBy` as the
  answer recorded it.

## The attendant lease

One actor attends an MR's CI at a time: this stage, a standalone watch-ci,
or the board's doctor. On GitLab only `ci_watch {attend: true}` claims: it
heartbeats every poll, re-claims a vanished lease twice per commit, and a
keepalive holds it between calls (a waiting gate included) until
`ci_lease_release`, another owner, or 60 minutes with no attending CI call.
Another owner's fresh lease, the doctor's included, returns `stood_down`
with `holder`. Never pass `underBoardLease`. `mr_retry {leaseMrUrl: <mr>}`
takes a lapsed lease back or refuses with `lease_held` and `holder`.

Every exit that knows the MR releases, except Fix and re-push, which keeps
it for the re-run. The stand-down never releases and writes no
`ci`: report the `holder` and stop; that lease is someone else's.

| Thought | Reality |
|---|---|
| "The doctor's on it, but I can fix or retry faster" | A repair is the lease holder's. Stand down and stop. |
| "On GitLab I'll heartbeat or claim by hand" | The keepalive and the `leaseMrUrl` guard cover it; only `ci_watch` claims. |
| "A ci_watch error, so a script or the GitLab CLI" | Fix the input once, then the off-script gate. |

## Budgets in this stage

Each `run_budget` counts one as its loop is entered; a `<sha12>` key
counts per watched commit. Its `spent?` diamond is yes when that call
returns `exhausted: true` (`spent >= limit`: the count that
reaches `limit` takes yes).
`infra-retries` counts just before the retry it allows, so an unchosen
retry is never spent.

## Domain rules

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

The domain supplies triage (reading a red, REAL or INFRA, which jobs block,
noise, ownership), judged at `Classify the triage report`, where it may
move a job between REAL and INFRA; it never watches, claims, releases,
retries or pushes. A rule that runs `<scripts>/ci-triage.sh` is the move
`STOP: GitLab triage goes through ci_triage` redirects: call `ci_triage`
with `pipelineId: <N>` (never the ref's newest pipeline). `<forge> jobs`
goes to `pipeline_jobs`; `ci-attendant.sh` or `ci-watch.sh` to
`ci_watch`. `ci_triage` reads its REAL and INFRA patterns, noisy jobs
and base settings from the `ci.triage.*` settings, on top of its built-in
patterns, so a rule's `--config` flag names no file to read. `config` carries only
what a rule states outright: `real-patterns`, `infra-patterns` and
`noisy-jobs` (string arrays) add to the settings; `base-depth`, `base-ref`
and `skip-base` replace them.

{{slot:domain}}

With nothing inlined, the graph's other flows apply.

## Forge

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

`<scripts>` is `{{stage.dir}}/scripts/`. `<scripts>/ci-triage.sh` and
`<forge> jobs` name a fill's old script calls; nothing is vendored for
them, and the redirects above send each to its tool.

{{slot:forge}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
