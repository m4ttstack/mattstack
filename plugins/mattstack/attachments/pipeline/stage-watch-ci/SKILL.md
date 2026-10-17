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

`<mr>` is `mr`'s https URL. Every CI tool takes `mrUrl: <mr>`; `mr_view`
and `mr_ready` take `repoName` = this worktree's absolute path and the iid
in `mr`. `<N>` is the number in `ci_watch`'s `pipeline.id`
(`gitlab:pipeline:N`).

```dot
digraph watch_ci {
    "Watch-ci stage entered" [shape=ellipse];
    "run_field_get {key: mr}" [shape=plaintext];
    "run_field_get {key: branch}" [shape=plaintext];
    "mr set?" [shape=diamond];
    "run_field_get {key: pushed}" [shape=plaintext];
    "git rev-parse HEAD (the pushed sha)" [shape=plaintext];
    "pushed set, and its sha is HEAD?" [shape=diamond];

    "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [shape=plaintext];
    "ci_watch state?" [shape=diamond];
    "End the turn: ci_watch runs in the background" [shape=box];
    "Trigger: the ci_watch task notification" [shape=ellipse];
    "STOP: GitLab CI goes through ci_watch, the read tools, gitlab_get and mr_retry" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: the lease holder owns every commit, push and retry" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Stand down: report the holder and stop" [shape=doublecircle];
    "Off-script gate: lease_unavailable" [shape=box];
    "run_budget {key: watch-ci:ci-watch-errors:<sha12>, limit: 1, stage}" [shape=plaintext];
    "ci-watch-errors spent?" [shape=diamond];
    "Fix what the ci_watch error names" [shape=box];
    "Off-script gate: ci_watch refused" [shape=box];
    "run_budget {key: watch-ci:ci-watch-off-script, limit: 1, stage}" [shape=plaintext];
    "ci-watch-off-script spent?" [shape=diamond];

    "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" [shape=plaintext];
    "Claim result (GitHub)?" [shape=diamond];
    "STOP: claim the lease only with ci_lease_claim" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_budget {key: watch-ci:github-claim-errors, limit: 1, stage}" [shape=plaintext];
    "github-claim-errors spent?" [shape=diamond];
    "Fix what the claim error names (GitHub)" [shape=box];
    "Off-script gate: ci_lease_claim refused (GitHub)" [shape=box];
    "run_budget {key: watch-ci:github-claim-off-script, limit: 1, stage}" [shape=plaintext];
    "github-claim-off-script spent?" [shape=diamond];
    "gh pr checks <mr>" [shape=plaintext];
    "gh pr checks exit?" [shape=diamond];
    "run_budget {key: watch-ci:github-polls:<sha12>, limit: 45, stage}" [shape=plaintext];
    "github-polls spent?" [shape=diamond];
    "ci_lease_heartbeat {mrUrl: <mr>}" [shape=plaintext];
    "Heartbeat result?" [shape=diamond];
    "sleep 60 as a background Bash task" [shape=plaintext];
    "gh pr view <mr> --json headRefOid" [shape=plaintext];
    "Checks are for the pushed sha?" [shape=diamond];
    "run_budget {key: watch-ci:github-sha-waits:<sha12>, limit: 5, stage}" [shape=plaintext];
    "github-sha-waits spent?" [shape=diamond];
    "Checks passed or failed?" [shape=diamond];
    "Classify each failing check REAL or INFRA" [shape=box];

    "ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}" [shape=plaintext];
    "ci_triage result?" [shape=diamond];
    "STOP: GitLab triage goes through ci_triage" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "UNCLEAR jobs in the report?" [shape=diamond];
    "mr_job_trace {mrUrl: <mr>, jobId, tailLines?, headLines?, grep?} per UNCLEAR job" [shape=plaintext];
    "Classify the triage report" [shape=box];
    "Classify each failure REAL or INFRA from failedJobs" [shape=box];
    "Only INFRA blocking failures, none INHERITED?" [shape=diamond];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage}" [shape=plaintext];
    "infra-retries spent?" [shape=diamond];

    "Retry on which forge?" [shape=diamond];
    "mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job" [shape=plaintext];
    "mr_retry result?" [shape=diamond];
    "Off-script gate: mr_retry refused" [shape=box];
    "run_budget {key: watch-ci:retry-off-script, limit: 1, stage}" [shape=plaintext];
    "retry-off-script spent?" [shape=diamond];
    "ci_lease_claim {mrUrl: <mr>, branch} (GitHub retry)" [shape=plaintext];
    "Re-claim result (GitHub retry)?" [shape=diamond];
    "Off-script gate: GitHub retry claim refused" [shape=box];
    "gh run rerun <run-id> --failed" [shape=plaintext];

    "Gate ci" [shape=box];
    "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage}" [shape=plaintext];
    "ci-gate-iterations spent?" [shape=diamond];
    "MR known (before the retry)?" [shape=diamond];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage} (ci gate retry)" [shape=plaintext];
    "infra-retries spent (ci gate retry)?" [shape=diamond];
    "run_field_set {key: ci, value: red: <triage>, stage}" [shape=plaintext];
    "run_status {status: abandoned}" [shape=plaintext];
    "Forge host (draft check)?" [shape=diamond];
    "mr_view {repoName, iid}" [shape=plaintext];
    "gh pr view <mr> --json isDraft" [shape=plaintext];
    "MR still a draft?" [shape=diamond];
    "Gate mark-ready" [shape=box];
    "run_budget {key: watch-ci:mark-ready-iterations, limit: 1, stage}" [shape=plaintext];
    "mark-ready-iterations spent?" [shape=diamond];
    "Forge host (mark-ready)?" [shape=diamond];
    "mr_ready {repoName, iid}" [shape=plaintext];
    "gh pr ready <number>" [shape=plaintext];
    "run_field_set {key: ci, value: green, stage}" [shape=plaintext];
    "MR known (exit)?" [shape=diamond];
    "ci_lease_release {mrUrl: <mr>}" [shape=plaintext];
    "Which exit is this?" [shape=diamond];
    "run_stage {action: fail, stage, reason, detailPath?}" [shape=plaintext];
    "run_hold {stage, reason, decidedBy}" [shape=plaintext];
    "Stage failed" [shape=doublecircle];
    "Hand Fix and re-push to the orchestrator: Redirect to implement" [shape=doublecircle];
    "Hand the Go back answer to the orchestrator" [shape=doublecircle];
    "Held: end the turn naming run and stage" [shape=doublecircle];
    "Run abandoned" [shape=doublecircle];
    "Watch-ci done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Watch-ci stage entered" -> "run_field_get {key: mr}";
    "run_field_get {key: mr}" -> "run_field_get {key: branch}";
    "run_field_get {key: branch}" -> "mr set?";
    "mr set?" -> "run_field_get {key: pushed}" [label="yes"];
    "mr set?" -> "Gate ci" [label="no: ship first"];
    "run_field_get {key: pushed}" -> "git rev-parse HEAD (the pushed sha)";
    "git rev-parse HEAD (the pushed sha)" -> "pushed set, and its sha is HEAD?";
    "pushed set, and its sha is HEAD?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="yes: its sha and non-null priorPipelineId"];
    "pushed set, and its sha is HEAD?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="no or unreadable: HEAD, no prior id"];

    "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" -> "ci_watch state?";
    "ci_watch state?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="running or waiting"];
    "ci_watch state?" -> "End the turn: ci_watch runs in the background" [label="backgrounded"];
    "End the turn: ci_watch runs in the background" -> "Trigger: the ci_watch task notification" [style=dashed];
    "Trigger: the ci_watch task notification" -> "ci_watch state?";
    "ci_watch state?" -> "Forge host (draft check)?" [label="success or success_with_warnings"];
    "ci_watch state?" -> "ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}" [label="failed"];
    "ci_watch state?" -> "Gate ci" [label="timeout, no_pipeline, canceled, skipped, manual, superseded or aborted"];
    "ci_watch state?" -> "STOP: the lease holder owns every commit, push and retry" [label="stood_down, holder named"];
    "ci_watch state?" -> "Off-script gate: lease_unavailable" [label="lease_unavailable"];
    "ci_watch state?" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" [label="unsupported_forge: GitHub"];
    "ci_watch state?" -> "run_budget {key: watch-ci:ci-watch-errors:<sha12>, limit: 1, stage}" [label="tool error"];
    "ci_watch state?" -> "STOP: GitLab CI goes through ci_watch, the read tools, gitlab_get and mr_retry" [label="tempted to watch with a script or the GitLab CLI"];
    "STOP: GitLab CI goes through ci_watch, the read tools, gitlab_get and mr_retry" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}";
    "STOP: the lease holder owns every commit, push and retry" -> "Stand down: report the holder and stop";

    "Off-script gate: lease_unavailable" -> "run_field_set {key: ci, value: red: <triage>, stage}" [label="take: human attends"];
    "Off-script gate: lease_unavailable" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="iterate: watch again"];
    "Off-script gate: lease_unavailable" -> "MR known (exit)?" [label="hold or hand back"];

    "run_budget {key: watch-ci:ci-watch-errors:<sha12>, limit: 1, stage}" -> "ci-watch-errors spent?";
    "ci-watch-errors spent?" -> "Fix what the ci_watch error names" [label="no"];
    "ci-watch-errors spent?" -> "Off-script gate: ci_watch refused" [label="yes"];
    "Fix what the ci_watch error names" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}";
    "Off-script gate: ci_watch refused" -> "Forge host (draft check)?" [label="take: green for the pushed sha"];
    "Off-script gate: ci_watch refused" -> "Gate ci" [label="take: red, or another sha"];
    "Off-script gate: ci_watch refused" -> "run_budget {key: watch-ci:ci-watch-off-script, limit: 1, stage}" [label="iterate"];
    "Off-script gate: ci_watch refused" -> "MR known (exit)?" [label="hold or hand back"];
    "run_budget {key: watch-ci:ci-watch-off-script, limit: 1, stage}" -> "ci-watch-off-script spent?";
    "ci-watch-off-script spent?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="no: watch again"];
    "ci-watch-off-script spent?" -> "MR known (exit)?" [label="yes: fail"];

    "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" -> "Claim result (GitHub)?";
    "Claim result (GitHub)?" -> "gh pr checks <mr>" [label="claimed: true"];
    "Claim result (GitHub)?" -> "STOP: the lease holder owns every commit, push and retry" [label="claimed: false, holder named"];
    "Claim result (GitHub)?" -> "run_budget {key: watch-ci:github-claim-errors, limit: 1, stage}" [label="tool error"];
    "Claim result (GitHub)?" -> "STOP: claim the lease only with ci_lease_claim" [label="tempted to write the lease by hand"];
    "STOP: claim the lease only with ci_lease_claim" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)";
    "run_budget {key: watch-ci:github-claim-errors, limit: 1, stage}" -> "github-claim-errors spent?";
    "github-claim-errors spent?" -> "Fix what the claim error names (GitHub)" [label="no"];
    "github-claim-errors spent?" -> "Off-script gate: ci_lease_claim refused (GitHub)" [label="yes"];
    "Fix what the claim error names (GitHub)" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)";
    "Off-script gate: ci_lease_claim refused (GitHub)" -> "run_field_set {key: ci, value: red: <triage>, stage}" [label="take: human attends"];
    "Off-script gate: ci_lease_claim refused (GitHub)" -> "run_budget {key: watch-ci:github-claim-off-script, limit: 1, stage}" [label="iterate"];
    "Off-script gate: ci_lease_claim refused (GitHub)" -> "MR known (exit)?" [label="hold or hand back"];
    "run_budget {key: watch-ci:github-claim-off-script, limit: 1, stage}" -> "github-claim-off-script spent?";
    "github-claim-off-script spent?" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" [label="no: claim again"];
    "github-claim-off-script spent?" -> "MR known (exit)?" [label="yes: fail"];

    "gh pr checks <mr>" -> "gh pr checks exit?";
    "gh pr checks exit?" -> "gh pr view <mr> --json headRefOid" [label="0, or another exit with checks reported"];
    "gh pr checks exit?" -> "run_budget {key: watch-ci:github-polls:<sha12>, limit: 45, stage}" [label="8, or no checks reported: pending"];
    "run_budget {key: watch-ci:github-polls:<sha12>, limit: 45, stage}" -> "github-polls spent?";
    "github-polls spent?" -> "ci_lease_heartbeat {mrUrl: <mr>}" [label="no"];
    "github-polls spent?" -> "Gate ci" [label="yes: timeout"];
    "ci_lease_heartbeat {mrUrl: <mr>}" -> "Heartbeat result?";
    "Heartbeat result?" -> "sleep 60 as a background Bash task" [label="ok: true"];
    "Heartbeat result?" -> "STOP: the lease holder owns every commit, push and retry" [label="lost"];
    "Heartbeat result?" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" [label="none: claim it again"];
    "Heartbeat result?" -> "Gate ci" [label="tool error"];
    "sleep 60 as a background Bash task" -> "gh pr checks <mr>";
    "gh pr view <mr> --json headRefOid" -> "Checks are for the pushed sha?";
    "Checks are for the pushed sha?" -> "Checks passed or failed?" [label="yes"];
    "Checks are for the pushed sha?" -> "run_budget {key: watch-ci:github-sha-waits:<sha12>, limit: 5, stage}" [label="no"];
    "run_budget {key: watch-ci:github-sha-waits:<sha12>, limit: 5, stage}" -> "github-sha-waits spent?";
    "github-sha-waits spent?" -> "sleep 60 as a background Bash task" [label="no: wait"];
    "github-sha-waits spent?" -> "Gate ci" [label="yes: no checks for the sha"];
    "Checks passed or failed?" -> "Forge host (draft check)?" [label="passed"];
    "Checks passed or failed?" -> "Classify each failing check REAL or INFRA" [label="failed"];
    "Classify each failing check REAL or INFRA" -> "Only INFRA blocking failures, none INHERITED?";

    "ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}" -> "ci_triage result?";
    "ci_triage result?" -> "UNCLEAR jobs in the report?" [label="triaged"];
    "ci_triage result?" -> "Classify each failure REAL or INFRA from failedJobs" [label="tool error: quote it"];
    "ci_triage result?" -> "STOP: GitLab triage goes through ci_triage" [label="tempted to run the vendored triage script"];
    "STOP: GitLab triage goes through ci_triage" -> "ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}";
    "UNCLEAR jobs in the report?" -> "mr_job_trace {mrUrl: <mr>, jobId, tailLines?, headLines?, grep?} per UNCLEAR job" [label="yes"];
    "UNCLEAR jobs in the report?" -> "Classify the triage report" [label="no"];
    "mr_job_trace {mrUrl: <mr>, jobId, tailLines?, headLines?, grep?} per UNCLEAR job" -> "Classify the triage report";
    "Classify the triage report" -> "Only INFRA blocking failures, none INHERITED?";
    "Classify each failure REAL or INFRA from failedJobs" -> "Only INFRA blocking failures, none INHERITED?";
    "Only INFRA blocking failures, none INHERITED?" -> "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage}" [label="yes"];
    "Only INFRA blocking failures, none INHERITED?" -> "Gate ci" [label="no: REAL, UNCLEAR or INHERITED"];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage}" -> "infra-retries spent?";
    "infra-retries spent?" -> "Retry on which forge?" [label="no: retry once"];
    "infra-retries spent?" -> "Gate ci" [label="yes: retried already"];

    "Retry on which forge?" -> "mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job" [label="GitLab"];
    "Retry on which forge?" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub retry)" [label="GitHub"];
    "mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job" -> "mr_retry result?";
    "mr_retry result?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="retried: watch again"];
    "mr_retry result?" -> "STOP: the lease holder owns every commit, push and retry" [label="refused: lease_held, holder named"];
    "mr_retry result?" -> "Off-script gate: mr_retry refused" [label="tool error"];
    "Off-script gate: mr_retry refused" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="take: human retried"];
    "Off-script gate: mr_retry refused" -> "run_budget {key: watch-ci:retry-off-script, limit: 1, stage}" [label="iterate"];
    "Off-script gate: mr_retry refused" -> "MR known (exit)?" [label="hold or hand back"];
    "run_budget {key: watch-ci:retry-off-script, limit: 1, stage}" -> "retry-off-script spent?";
    "retry-off-script spent?" -> "Retry on which forge?" [label="no: retry again"];
    "retry-off-script spent?" -> "MR known (exit)?" [label="yes: fail"];
    "ci_lease_claim {mrUrl: <mr>, branch} (GitHub retry)" -> "Re-claim result (GitHub retry)?";
    "Re-claim result (GitHub retry)?" -> "gh run rerun <run-id> --failed" [label="claimed: true"];
    "Re-claim result (GitHub retry)?" -> "STOP: the lease holder owns every commit, push and retry" [label="claimed: false, holder named"];
    "Re-claim result (GitHub retry)?" -> "Off-script gate: GitHub retry claim refused" [label="tool error"];
    "Off-script gate: GitHub retry claim refused" -> "gh pr checks <mr>" [label="take: human reran"];
    "Off-script gate: GitHub retry claim refused" -> "run_budget {key: watch-ci:retry-off-script, limit: 1, stage}" [label="iterate"];
    "Off-script gate: GitHub retry claim refused" -> "MR known (exit)?" [label="hold or hand back"];
    "gh run rerun <run-id> --failed" -> "gh pr checks <mr>";

    "Gate ci" -> "Hand Fix and re-push to the orchestrator: Redirect to implement" [label="fix and re-push: no ci, lease kept"];
    "Gate ci" -> "MR known (before the retry)?" [label="retry the job"];
    "Gate ci" -> "run_field_set {key: ci, value: red: <triage>, stage}" [label="hand back"];
    "Gate ci" -> "MR known (exit)?" [label="abandon, go back or hold"];
    "Gate ci" -> "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage}" [label="iterate"];
    "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage}" -> "ci-gate-iterations spent?";
    "ci-gate-iterations spent?" -> "Gate ci" [label="no: re-triage with their note"];
    "ci-gate-iterations spent?" -> "run_field_set {key: ci, value: red: <triage>, stage}" [label="yes: hand back"];
    "MR known (before the retry)?" -> "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage} (ci gate retry)" [label="yes"];
    "MR known (before the retry)?" -> "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage}" [label="no: nothing to retry"];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage} (ci gate retry)" -> "infra-retries spent (ci gate retry)?";
    "infra-retries spent (ci gate retry)?" -> "Retry on which forge?" [label="no"];
    "infra-retries spent (ci gate retry)?" -> "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage}" [label="yes: reopen"];
    "run_status {status: abandoned}" -> "Run abandoned";

    "Forge host (draft check)?" -> "mr_view {repoName, iid}" [label="GitLab"];
    "Forge host (draft check)?" -> "gh pr view <mr> --json isDraft" [label="GitHub"];
    "Forge host (draft check)?" -> "run_field_set {key: ci, value: green, stage}" [label="anything else"];
    "mr_view {repoName, iid}" -> "MR still a draft?";
    "gh pr view <mr> --json isDraft" -> "MR still a draft?";
    "MR still a draft?" -> "Gate mark-ready" [label="yes"];
    "MR still a draft?" -> "run_field_set {key: ci, value: green, stage}" [label="no"];
    "Gate mark-ready" -> "Forge host (mark-ready)?" [label="mark ready now"];
    "Gate mark-ready" -> "run_field_set {key: ci, value: green, stage}" [label="keep it draft"];
    "Gate mark-ready" -> "MR known (exit)?" [label="go back or hold"];
    "Gate mark-ready" -> "run_budget {key: watch-ci:mark-ready-iterations, limit: 1, stage}" [label="iterate"];
    "run_budget {key: watch-ci:mark-ready-iterations, limit: 1, stage}" -> "mark-ready-iterations spent?";
    "mark-ready-iterations spent?" -> "Gate mark-ready" [label="no: reopen with their note"];
    "mark-ready-iterations spent?" -> "run_field_set {key: ci, value: green, stage}" [label="yes: keep it draft"];
    "Forge host (mark-ready)?" -> "mr_ready {repoName, iid}" [label="GitLab"];
    "Forge host (mark-ready)?" -> "gh pr ready <number>" [label="GitHub"];
    "mr_ready {repoName, iid}" -> "run_field_set {key: ci, value: green, stage}";
    "gh pr ready <number>" -> "run_field_set {key: ci, value: green, stage}";
    "run_field_set {key: ci, value: green, stage}" -> "MR known (exit)?";
    "run_field_set {key: ci, value: red: <triage>, stage}" -> "MR known (exit)?";

    "MR known (exit)?" -> "ci_lease_release {mrUrl: <mr>}" [label="yes"];
    "MR known (exit)?" -> "Which exit is this?" [label="no"];
    "ci_lease_release {mrUrl: <mr>}" -> "Which exit is this?";
    "Which exit is this?" -> "Watch-ci done: return to the orchestrator" [label="ci written"];
    "Which exit is this?" -> "run_hold {stage, reason, decidedBy}" [label="hold"];
    "Which exit is this?" -> "Hand the Go back answer to the orchestrator" [label="go back"];
    "Which exit is this?" -> "run_status {status: abandoned}" [label="abandon"];
    "Which exit is this?" -> "run_stage {action: fail, stage, reason, detailPath?}" [label="a failure or off-script hand back"];
    "run_hold {stage, reason, decidedBy}" -> "Held: end the turn naming run and stage";
    "run_stage {action: fail, stage, reason, detailPath?}" -> "Stage failed";
}
```

### End the turn: ci_watch runs in the background

A `ci_watch` still running after 120 s moves to the background, and its
`<task-notification>` `<result>` is the next `ci_watch state`. End the
turn in one line: `watching CI in the background (task <id>)`. The
pipeline gate stop hook lets a turn end while a background task is
pending, and a chat or user message arriving meanwhile reaches you at
once; a foreground wait (a `sleep`, a polling script, a second `ci_watch`)
delays the result and every message.

### The off-script gates

Each is the gate protocol's Off-script gate (scope
`off-script:watch-ci:<n>`, `context` quoting the refusal): `action`
**Take** (the move its section names) / **Hand back** (a failure, the
refusal its reason); `next` **Proceed** (Recommended) / **Iterate
here** (the human fixed it) / **Hold**. A spent Iterate budget fails the
same way, quoting the refusals. An attending Take writes `ci` red,
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

Read the failing checks' logs from the links `gh pr checks <mr>` prints and
classify as the triage-report section says, ownership unknown.

### Off-script gate: mr_retry refused

`mr_retry` errored (`lease_held` is the stand-down); `context` quotes the
error and job ids. Take: the human retried the job.

### Off-script gate: GitHub retry claim refused

The re-claim before `gh run rerun` errored. Take: the human reran the job.

### Reading a GitLab fact no read tool returns

Read it with `gitlab_get {repoName, path}` (`repoName` this worktree,
`path` from the API root, `:id` for this project:
`projects/:id/jobs/<jobId>`) within the step, not as an off-script move.
Quote a GitLab error as written; a refused credential path is final.

### Gate ci

Quote any error that led here. On `no_pipeline`, `pushed: false` means the
MR head is `remoteSha`: say ship first; `pushed: true` means no pipeline
ran for it. Scope `ci:watch-ci:<attempt>`. One sentence above the form: the
verdict and a one-line triage per blocking failure.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `action` (write-in) | **Fix and re-push (Recommended)** (a REAL failure in your change; from the third one in a run the suffix moves to **Hand back**) / **Retry the job** (a flake not yet retried) / **Hand back** (leave it red for the human) / **Abandon the run** | always |
| `next` | **Proceed** / **Iterate here** / **Go back to `<stage>`** / **Hold** | always |

Selection: `{"next":"fix|retry|handback|abandon|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.
An `action` write-in adds `"action": {"writeIn": "<their words>"}`, and
`next` records `iterate`, or the deliberate `next` pick (Hold or Go back)
that won.

### Gate mark-ready

One sentence above the form: CI is green for the MR's head, and whether
`evidence` is set.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `ready` (write-in) | **Mark ready now (Recommended)** (when `evidence` is set and not `-`) / **Keep it draft** | always |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage | Go back, with more than one earlier stage row |

Selection: `{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.

## What the graph cannot show

- **The pushed sha.** The ship stage writes `pushed` = `{"sha",
  "priorPipelineId"}`; `<sha12>` is the watched sha's first 12 characters.
  A `priorPipelineId` a result carries goes on the next call; the watched
  pipeline's own `pipeline.id` never does. Both diamond edges call
  `ci_watch`; each label says what to pass.
- **The tool owns the watch window.** `timeout` (against
  `ci.watch.budgetMinutes`) and `no_pipeline` (10 minutes without one) are
  `ci_watch`'s own: pass no budget arguments, count nothing.
- **The sha guard.** `ci_watch` counts only a pipeline for `sha` (a
  success is green only for it) and returns `superseded` when the head
  moves on. On GitHub `headRefOid` must equal it, "no checks reported" is
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
| "On GitLab I'll heartbeat or claim by hand" | The keepalive and the `leaseMrUrl` guard cover it, and only `ci_watch` claims. |
| "A ci_watch error, so a script or the GitLab CLI" | Fix the input once, then the off-script gate. |

## Budgets in this stage

Each `run_budget` counts one as its loop is entered; a `<sha12>` key
counts per watched commit. Its
`spent?` diamond reads `spent` against `limit` (`spent > limit`); ignore
`exhausted` and `remaining` (`exhausted` is `spent >= limit` and would stop
one round early). `infra-retries` counts right before the retry it allows,
so a retry nobody chose is never spent.

## Domain rules

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

The domain supplies triage (reading a red, REAL or INFRA, which jobs block,
noise, ownership), judged at `Classify the triage report`, where it may
move a job between REAL and INFRA; it never watches, claims, releases,
retries or pushes. A rule that runs `<scripts>/ci-triage.sh` is the move
`STOP: GitLab triage goes through ci_triage` redirects: call `ci_triage`
with `pipelineId: <N>` (never the ref's newest pipeline) and the rule's
`--config` file's keys as `config`, its only source (the file sits under
`parts/domain/`). `<forge> jobs` goes to `pipeline_jobs`;
`ci-attendant.sh` or `ci-watch.sh` to `ci_watch`.

{{slot:domain}}

When nothing is inlined above, the graph's other flows apply.

## Forge

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

`<scripts>` is `{{stage.dir}}/scripts/` and `<forge>` is
`{{stage.dir}}/parts/forge/scripts/ci-forge.sh`, vendored for the fills
that name them; this stage calls neither.

{{slot:forge}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
