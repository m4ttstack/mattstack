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
`run_field_get`, write `ci` with `run_field_set` (`stage: "watch-ci"`) once
a verdict exists, and on failure write `run_stage {action: fail, stage:
"watch-ci", reason, detailPath}` with `detailPath` = the triage report.

`<mr>` is `mr`'s https URL. Every CI tool takes `mrUrl: <mr>`; `mr_view`
and `mr_ready` take `repoName` = this worktree's absolute path and the iid
in `mr`. `<N>` is the number in `ci_watch`'s `pipeline.id`
(`gitlab:pipeline:N`); `config` comes only from a domain rule.

```dot
digraph watch_ci {
    rankdir=TB;

    "Watch-ci stage entered" [shape=ellipse];
    "run_field_get {key: mr}" [shape=plaintext];
    "run_field_get {key: branch}" [shape=plaintext];
    "mr set?" [shape=diamond];
    "run_field_get {key: pushed}" [shape=plaintext];
    "git rev-parse HEAD (the pushed sha)" [shape=plaintext];
    "pushed set, and its sha is HEAD?" [shape=diamond];

    "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [shape=plaintext];
    "ci_watch state?" [shape=diamond];
    "End the turn: ci_watch runs in the background (task <id>)" [shape=box];
    "Trigger: the ci_watch task notification re-invoked this stage" [shape=ellipse];
    "STOP: GitLab CI watches go through ci_watch, reads through the read tools or gitlab_get, retries through mr_retry" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Stand down: report it and stop (stage)" [shape=doublecircle];
    "Off-script gate: ci_watch could not hold the lease" [shape=box];
    "off-script answer (lease_unavailable)?" [shape=diamond];
    "run_budget {key: watch-ci:lease-rounds:<sha12>, limit: 2, stage: watch-ci}" [shape=plaintext];
    "lease-rounds past its limit?" [shape=diamond];
    "run_budget {key: watch-ci:ci-watch-errors:<sha12>, limit: 1, stage: watch-ci}" [shape=plaintext];
    "ci-watch-errors past its limit?" [shape=diamond];
    "Fix what the ci_watch error names (stage)" [shape=box];
    "Off-script gate: ci_watch refused" [shape=box];
    "off-script answer (ci_watch)?" [shape=diamond];
    "Verdict the human reported?" [shape=diamond];
    "run_budget {key: watch-ci:ci-watch-off-script, limit: 1, stage: watch-ci}" [shape=plaintext];
    "ci-watch-off-script past its limit?" [shape=diamond];

    "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" [shape=plaintext];
    "ci_lease_claim result (GitHub)?" [shape=diamond];
    "STOP: claim the lease only with ci_lease_claim" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "run_budget {key: watch-ci:github-claim-errors, limit: 1, stage: watch-ci}" [shape=plaintext];
    "github-claim-errors past its limit?" [shape=diamond];
    "Fix what the claim error names (GitHub)" [shape=box];
    "Off-script gate: ci_lease_claim refused (GitHub)" [shape=box];
    "off-script answer (ci_lease_claim, GitHub)?" [shape=diamond];
    "run_budget {key: watch-ci:github-claim-off-script, limit: 1, stage: watch-ci}" [shape=plaintext];
    "github-claim-off-script past its limit?" [shape=diamond];
    "gh pr checks <mr> (stage poll)" [shape=plaintext];
    "gh pr checks exit?" [shape=diamond];
    "run_budget {key: watch-ci:github-polls:<sha12>, limit: 45, stage: watch-ci}" [shape=plaintext];
    "github-polls past its limit?" [shape=diamond];
    "ci_lease_heartbeat {mrUrl: <mr>} (stage poll)" [shape=plaintext];
    "Heartbeat result?" [shape=diamond];
    "sleep 60 as a background Bash task (stage poll)" [shape=plaintext];
    "gh pr view <mr> --json headRefOid (stage sha guard)" [shape=plaintext];
    "Checks are for the pushed sha?" [shape=diamond];
    "run_budget {key: watch-ci:github-sha-waits:<sha12>, limit: 5, stage: watch-ci}" [shape=plaintext];
    "github-sha-waits past its limit?" [shape=diamond];
    "sleep 60 as a background Bash task (stage sha wait)" [shape=plaintext];
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
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci, increment: 0}" [shape=plaintext];
    "infra-retries spent?" [shape=diamond];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci}" [shape=plaintext];

    "Retry on which forge?" [shape=diamond];
    "mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job" [shape=plaintext];
    "mr_retry result?" [shape=diamond];
    "Off-script gate: mr_retry refused" [shape=box];
    "off-script answer (mr_retry)?" [shape=diamond];
    "run_budget {key: watch-ci:retry-off-script, limit: 1, stage: watch-ci}" [shape=plaintext];
    "retry-off-script past its limit?" [shape=diamond];
    "ci_lease_claim {mrUrl: <mr>, branch} (before the GitHub retry)" [shape=plaintext];
    "Re-claim result (before the GitHub retry)?" [shape=diamond];
    "Off-script gate: ci_lease_claim refused (before the GitHub retry)" [shape=box];
    "off-script answer (GitHub retry claim)?" [shape=diamond];
    "run_budget {key: watch-ci:retry-off-script, limit: 1, stage: watch-ci} (GitHub retry claim)" [shape=plaintext];
    "retry-off-script past its limit (GitHub retry claim)?" [shape=diamond];
    "gh run rerun <run-id> --failed (stage)" [shape=plaintext];

    "Gate ci (table below)" [shape=box];
    "ci answer?" [shape=diamond];
    "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage: watch-ci}" [shape=plaintext];
    "ci-gate-iterations past its limit?" [shape=diamond];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci, increment: 0} (ci gate retry)" [shape=plaintext];
    "infra-retries spent (ci gate retry)?" [shape=diamond];
    "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [shape=plaintext];
    "run_status {status: abandoned}" [shape=plaintext];
    "Forge host (stage draft check)?" [shape=diamond];
    "mr_view {repoName, iid}" [shape=plaintext];
    "gh pr view <mr> --json isDraft" [shape=plaintext];
    "MR still a draft?" [shape=diamond];
    "Gate mark-ready (table below)" [shape=box];
    "ready answer?" [shape=diamond];
    "run_budget {key: watch-ci:mark-ready-iterations, limit: 1, stage: watch-ci}" [shape=plaintext];
    "mark-ready-iterations past its limit?" [shape=diamond];
    "Forge host (stage mark-ready)?" [shape=diamond];
    "mr_ready {repoName, iid}" [shape=plaintext];
    "gh pr ready <number>" [shape=plaintext];
    "run_field_set {key: ci, value: green, stage: watch-ci}" [shape=plaintext];
    "MR known (exit)?" [shape=diamond];
    "ci_lease_release {mrUrl: <mr>}" [shape=plaintext];
    "Which exit is this?" [shape=diamond];
    "run_stage {action: fail, stage: watch-ci, reason}" [shape=plaintext];
    "run_hold {stage: watch-ci, reason, decidedBy}" [shape=plaintext];
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
    "mr set?" -> "Gate ci (table below)" [label="no: reason is no MR to watch, ship first"];
    "run_field_get {key: pushed}" -> "git rev-parse HEAD (the pushed sha)";
    "git rev-parse HEAD (the pushed sha)" -> "pushed set, and its sha is HEAD?";
    "pushed set, and its sha is HEAD?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="yes: its sha, and its priorPipelineId when not null"];
    "pushed set, and its sha is HEAD?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="no, unset or unreadable: HEAD, no prior id"];

    "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" -> "ci_watch state?";
    "ci_watch state?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="running or waiting: call again"];
    "ci_watch state?" -> "End the turn: ci_watch runs in the background (task <id>)" [label="backgrounded: moved to the background as task <id>"];
    "End the turn: ci_watch runs in the background (task <id>)" -> "Trigger: the ci_watch task notification re-invoked this stage" [style=dashed];
    "Trigger: the ci_watch task notification re-invoked this stage" -> "ci_watch state?";
    "ci_watch state?" -> "Forge host (stage draft check)?" [label="success or success_with_warnings"];
    "ci_watch state?" -> "ci_triage {mrUrl: <mr>, pipelineId: <N>, config?}" [label="failed"];
    "ci_watch state?" -> "Gate ci (table below)" [label="timeout, no_pipeline, canceled, skipped, manual, superseded or aborted"];
    "ci_watch state?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="stood_down, holder named"];
    "ci_watch state?" -> "Off-script gate: ci_watch could not hold the lease" [label="lease_unavailable"];
    "ci_watch state?" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" [label="unsupported_forge: a GitHub PR"];
    "ci_watch state?" -> "run_budget {key: watch-ci:ci-watch-errors:<sha12>, limit: 1, stage: watch-ci}" [label="tool error"];
    "ci_watch state?" -> "STOP: GitLab CI watches go through ci_watch, reads through the read tools or gitlab_get, retries through mr_retry" [label="tempted to watch with a script or the GitLab CLI"];
    "STOP: GitLab CI watches go through ci_watch, reads through the read tools or gitlab_get, retries through mr_retry" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}";
    "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" -> "Stand down: report it and stop (stage)";

    "Off-script gate: ci_watch could not hold the lease" -> "off-script answer (lease_unavailable)?";
    "off-script answer (lease_unavailable)?" -> "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [label="take: the human attends the MR"];
    "off-script answer (lease_unavailable)?" -> "run_budget {key: watch-ci:lease-rounds:<sha12>, limit: 2, stage: watch-ci}" [label="iterate: the human fixed it"];
    "off-script answer (lease_unavailable)?" -> "MR known (exit)?" [label="hold or hand back"];
    "run_budget {key: watch-ci:lease-rounds:<sha12>, limit: 2, stage: watch-ci}" -> "lease-rounds past its limit?";
    "lease-rounds past its limit?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="no: watch again"];
    "lease-rounds past its limit?" -> "MR known (exit)?" [label="yes: a failure, the refusals are the reason"];

    "run_budget {key: watch-ci:ci-watch-errors:<sha12>, limit: 1, stage: watch-ci}" -> "ci-watch-errors past its limit?";
    "ci-watch-errors past its limit?" -> "Fix what the ci_watch error names (stage)" [label="no"];
    "ci-watch-errors past its limit?" -> "Off-script gate: ci_watch refused" [label="yes"];
    "Fix what the ci_watch error names (stage)" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}";
    "Off-script gate: ci_watch refused" -> "off-script answer (ci_watch)?";
    "off-script answer (ci_watch)?" -> "Verdict the human reported?" [label="take: the human read the pipeline"];
    "off-script answer (ci_watch)?" -> "run_budget {key: watch-ci:ci-watch-off-script, limit: 1, stage: watch-ci}" [label="iterate: the human fixed it"];
    "off-script answer (ci_watch)?" -> "MR known (exit)?" [label="hold or hand back"];
    "Verdict the human reported?" -> "Forge host (stage draft check)?" [label="green for the pushed sha"];
    "Verdict the human reported?" -> "Gate ci (table below)" [label="red, or not for the pushed sha"];
    "run_budget {key: watch-ci:ci-watch-off-script, limit: 1, stage: watch-ci}" -> "ci-watch-off-script past its limit?";
    "ci-watch-off-script past its limit?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="no: watch again"];
    "ci-watch-off-script past its limit?" -> "MR known (exit)?" [label="yes: a failure, the refusals are the reason"];

    "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" -> "ci_lease_claim result (GitHub)?";
    "ci_lease_claim result (GitHub)?" -> "gh pr checks <mr> (stage poll)" [label="claimed: true, the PR is yours"];
    "ci_lease_claim result (GitHub)?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="claimed: false, holder named"];
    "ci_lease_claim result (GitHub)?" -> "run_budget {key: watch-ci:github-claim-errors, limit: 1, stage: watch-ci}" [label="tool error"];
    "ci_lease_claim result (GitHub)?" -> "STOP: claim the lease only with ci_lease_claim" [label="tempted to write the lease by hand or with a script"];
    "STOP: claim the lease only with ci_lease_claim" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)";
    "run_budget {key: watch-ci:github-claim-errors, limit: 1, stage: watch-ci}" -> "github-claim-errors past its limit?";
    "github-claim-errors past its limit?" -> "Fix what the claim error names (GitHub)" [label="no"];
    "github-claim-errors past its limit?" -> "Off-script gate: ci_lease_claim refused (GitHub)" [label="yes"];
    "Fix what the claim error names (GitHub)" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)";
    "Off-script gate: ci_lease_claim refused (GitHub)" -> "off-script answer (ci_lease_claim, GitHub)?";
    "off-script answer (ci_lease_claim, GitHub)?" -> "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [label="take: the human attends the PR"];
    "off-script answer (ci_lease_claim, GitHub)?" -> "run_budget {key: watch-ci:github-claim-off-script, limit: 1, stage: watch-ci}" [label="iterate: the human fixed it"];
    "off-script answer (ci_lease_claim, GitHub)?" -> "MR known (exit)?" [label="hold or hand back"];
    "run_budget {key: watch-ci:github-claim-off-script, limit: 1, stage: watch-ci}" -> "github-claim-off-script past its limit?";
    "github-claim-off-script past its limit?" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" [label="no: claim again"];
    "github-claim-off-script past its limit?" -> "MR known (exit)?" [label="yes: a failure, the refusals are the reason"];

    "gh pr checks <mr> (stage poll)" -> "gh pr checks exit?";
    "gh pr checks exit?" -> "gh pr view <mr> --json headRefOid (stage sha guard)" [label="0, or any other exit with checks reported: passed or failed"];
    "gh pr checks exit?" -> "run_budget {key: watch-ci:github-polls:<sha12>, limit: 45, stage: watch-ci}" [label="8, or no checks reported: pending"];
    "run_budget {key: watch-ci:github-polls:<sha12>, limit: 45, stage: watch-ci}" -> "github-polls past its limit?";
    "github-polls past its limit?" -> "ci_lease_heartbeat {mrUrl: <mr>} (stage poll)" [label="no"];
    "github-polls past its limit?" -> "Gate ci (table below)" [label="yes: timeout"];
    "ci_lease_heartbeat {mrUrl: <mr>} (stage poll)" -> "Heartbeat result?";
    "Heartbeat result?" -> "sleep 60 as a background Bash task (stage poll)" [label="ok: true"];
    "Heartbeat result?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="lost"];
    "Heartbeat result?" -> "ci_lease_claim {mrUrl: <mr>, branch} (GitHub)" [label="none: claim it again"];
    "Heartbeat result?" -> "Gate ci (table below)" [label="tool error"];
    "sleep 60 as a background Bash task (stage poll)" -> "gh pr checks <mr> (stage poll)";
    "gh pr view <mr> --json headRefOid (stage sha guard)" -> "Checks are for the pushed sha?";
    "Checks are for the pushed sha?" -> "Checks passed or failed?" [label="yes"];
    "Checks are for the pushed sha?" -> "run_budget {key: watch-ci:github-sha-waits:<sha12>, limit: 5, stage: watch-ci}" [label="no"];
    "run_budget {key: watch-ci:github-sha-waits:<sha12>, limit: 5, stage: watch-ci}" -> "github-sha-waits past its limit?";
    "github-sha-waits past its limit?" -> "sleep 60 as a background Bash task (stage sha wait)" [label="no"];
    "github-sha-waits past its limit?" -> "Gate ci (table below)" [label="yes: no checks for the pushed sha"];
    "sleep 60 as a background Bash task (stage sha wait)" -> "gh pr checks <mr> (stage poll)";
    "Checks passed or failed?" -> "Forge host (stage draft check)?" [label="passed"];
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
    "Only INFRA blocking failures, none INHERITED?" -> "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci, increment: 0}" [label="yes"];
    "Only INFRA blocking failures, none INHERITED?" -> "Gate ci (table below)" [label="no: a REAL, UNCLEAR or INHERITED failure"];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci, increment: 0}" -> "infra-retries spent?";
    "infra-retries spent?" -> "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci}" [label="no: retry once"];
    "infra-retries spent?" -> "Gate ci (table below)" [label="yes: retried already"];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci}" -> "Retry on which forge?";

    "Retry on which forge?" -> "mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job" [label="GitLab"];
    "Retry on which forge?" -> "ci_lease_claim {mrUrl: <mr>, branch} (before the GitHub retry)" [label="GitHub"];
    "mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job" -> "mr_retry result?";
    "mr_retry result?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="retried: watch again"];
    "mr_retry result?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="refused: lease_held, holder named"];
    "mr_retry result?" -> "Off-script gate: mr_retry refused" [label="tool error"];
    "Off-script gate: mr_retry refused" -> "off-script answer (mr_retry)?";
    "off-script answer (mr_retry)?" -> "ci_watch {mrUrl: <mr>, sha, priorPipelineId?, attend: true}" [label="take: the human retried the job"];
    "off-script answer (mr_retry)?" -> "run_budget {key: watch-ci:retry-off-script, limit: 1, stage: watch-ci}" [label="iterate: the human fixed it"];
    "off-script answer (mr_retry)?" -> "MR known (exit)?" [label="hold or hand back"];
    "run_budget {key: watch-ci:retry-off-script, limit: 1, stage: watch-ci}" -> "retry-off-script past its limit?";
    "retry-off-script past its limit?" -> "mr_retry {mrUrl: <mr>, jobId, leaseMrUrl: <mr>} per INFRA job" [label="no: retry again"];
    "retry-off-script past its limit?" -> "MR known (exit)?" [label="yes: a failure, the refusals are the reason"];
    "ci_lease_claim {mrUrl: <mr>, branch} (before the GitHub retry)" -> "Re-claim result (before the GitHub retry)?";
    "Re-claim result (before the GitHub retry)?" -> "gh run rerun <run-id> --failed (stage)" [label="claimed: true"];
    "Re-claim result (before the GitHub retry)?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="claimed: false, holder named"];
    "Re-claim result (before the GitHub retry)?" -> "Off-script gate: ci_lease_claim refused (before the GitHub retry)" [label="tool error"];
    "Off-script gate: ci_lease_claim refused (before the GitHub retry)" -> "off-script answer (GitHub retry claim)?";
    "off-script answer (GitHub retry claim)?" -> "gh pr checks <mr> (stage poll)" [label="take: the human reran the job"];
    "off-script answer (GitHub retry claim)?" -> "run_budget {key: watch-ci:retry-off-script, limit: 1, stage: watch-ci} (GitHub retry claim)" [label="iterate: the human fixed it"];
    "off-script answer (GitHub retry claim)?" -> "MR known (exit)?" [label="hold or hand back"];
    "run_budget {key: watch-ci:retry-off-script, limit: 1, stage: watch-ci} (GitHub retry claim)" -> "retry-off-script past its limit (GitHub retry claim)?";
    "retry-off-script past its limit (GitHub retry claim)?" -> "ci_lease_claim {mrUrl: <mr>, branch} (before the GitHub retry)" [label="no: claim again"];
    "retry-off-script past its limit (GitHub retry claim)?" -> "MR known (exit)?" [label="yes: a failure, the refusals are the reason"];
    "gh run rerun <run-id> --failed (stage)" -> "gh pr checks <mr> (stage poll)";

    "Gate ci (table below)" -> "ci answer?";
    "ci answer?" -> "Hand Fix and re-push to the orchestrator: Redirect to implement" [label="fix and re-push: write no ci, keep the lease"];
    "ci answer?" -> "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci, increment: 0} (ci gate retry)" [label="retry the job"];
    "ci answer?" -> "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [label="hand back"];
    "ci answer?" -> "MR known (exit)?" [label="abandon, go back or hold"];
    "ci answer?" -> "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage: watch-ci}" [label="iterate"];
    "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage: watch-ci}" -> "ci-gate-iterations past its limit?";
    "ci-gate-iterations past its limit?" -> "Gate ci (table below)" [label="no: re-triage with their note, a new gate"];
    "ci-gate-iterations past its limit?" -> "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [label="yes: hand back"];
    "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci, increment: 0} (ci gate retry)" -> "infra-retries spent (ci gate retry)?";
    "infra-retries spent (ci gate retry)?" -> "run_budget {key: watch-ci:infra-retries:<sha12>, limit: 1, stage: watch-ci}" [label="no"];
    "infra-retries spent (ci gate retry)?" -> "run_budget {key: watch-ci:ci-gate-iterations, limit: 2, stage: watch-ci}" [label="yes: reopen, the retry is spent"];
    "run_status {status: abandoned}" -> "Run abandoned";

    "Forge host (stage draft check)?" -> "mr_view {repoName, iid}" [label="GitLab"];
    "Forge host (stage draft check)?" -> "gh pr view <mr> --json isDraft" [label="GitHub"];
    "Forge host (stage draft check)?" -> "run_field_set {key: ci, value: green, stage: watch-ci}" [label="anything else: nothing to mark ready"];
    "mr_view {repoName, iid}" -> "MR still a draft?";
    "gh pr view <mr> --json isDraft" -> "MR still a draft?";
    "MR still a draft?" -> "Gate mark-ready (table below)" [label="yes"];
    "MR still a draft?" -> "run_field_set {key: ci, value: green, stage: watch-ci}" [label="no"];
    "Gate mark-ready (table below)" -> "ready answer?";
    "ready answer?" -> "Forge host (stage mark-ready)?" [label="mark ready now"];
    "ready answer?" -> "run_field_set {key: ci, value: green, stage: watch-ci}" [label="keep it draft"];
    "ready answer?" -> "MR known (exit)?" [label="go back or hold"];
    "ready answer?" -> "run_budget {key: watch-ci:mark-ready-iterations, limit: 1, stage: watch-ci}" [label="iterate"];
    "run_budget {key: watch-ci:mark-ready-iterations, limit: 1, stage: watch-ci}" -> "mark-ready-iterations past its limit?";
    "mark-ready-iterations past its limit?" -> "Gate mark-ready (table below)" [label="no: a new gate with their note"];
    "mark-ready-iterations past its limit?" -> "run_field_set {key: ci, value: green, stage: watch-ci}" [label="yes: keep it draft"];
    "Forge host (stage mark-ready)?" -> "mr_ready {repoName, iid}" [label="GitLab"];
    "Forge host (stage mark-ready)?" -> "gh pr ready <number>" [label="GitHub"];
    "mr_ready {repoName, iid}" -> "run_field_set {key: ci, value: green, stage: watch-ci}";
    "gh pr ready <number>" -> "run_field_set {key: ci, value: green, stage: watch-ci}";
    "run_field_set {key: ci, value: green, stage: watch-ci}" -> "MR known (exit)?";
    "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" -> "MR known (exit)?";

    "MR known (exit)?" -> "ci_lease_release {mrUrl: <mr>}" [label="yes"];
    "MR known (exit)?" -> "Which exit is this?" [label="no: mr unset"];
    "ci_lease_release {mrUrl: <mr>}" -> "Which exit is this?";
    "Which exit is this?" -> "Watch-ci done: return to the orchestrator" [label="ci written"];
    "Which exit is this?" -> "run_hold {stage: watch-ci, reason, decidedBy}" [label="hold"];
    "Which exit is this?" -> "Hand the Go back answer to the orchestrator" [label="go back"];
    "Which exit is this?" -> "run_status {status: abandoned}" [label="abandon"];
    "Which exit is this?" -> "run_stage {action: fail, stage: watch-ci, reason}" [label="a failure, or an off-script hand back"];
    "run_hold {stage: watch-ci, reason, decidedBy}" -> "Held: end the turn naming run and stage";
    "run_stage {action: fail, stage: watch-ci, reason}" -> "Stage failed";
}
```

### End the turn: ci_watch runs in the background (task <id>)

Claude Code moves a `ci_watch` still running after 120 s to the background
and re-invokes this pane with its result as a `<task-notification>`, whose
`<result>` is the next `ci_watch state`. End the turn in one line:
`watching CI in the background (task <id>)`. A foreground wait (a `sleep`,
a polling script, a second `ci_watch`) delays the result and every
message.

### The off-script gates

Every off-script gate below has scope `off-script:watch-ci:<n>` (`n` counts
from 1 within the stage attempt), `context` quoting the refusal, and:

| Question | Options |
|---|---|
| `action` | **Take** (the human makes the move, named in the gate's section) / **Iterate** (the human fixed it: try again) / **Hand back** (a failure, the refusal is the reason) |
| `next` | **Proceed** (Recommended) / **Hold** |

Iterate counts one round on the gate's own off-script budget first: the
first tries again, and a second fails the verb (`lease-rounds` allows a
second try). A Take
that means the human attends the MR writes `ci` red with the refusal as the
triage line.

### Off-script gate: ci_watch could not hold the lease

`lease_unavailable`: the lease could not be claimed or kept (`error` says
why). No one else holds it, so this is not a stand-down. Take: the human
attends the MR. Budget: `lease-rounds`.

### Fix what the ci_watch error names (stage)

Correct what the error names (`mrUrl` the MR's https URL, `sha` 7 to 40 hex
characters, `priorPipelineId` the `N` of `gitlab:pipeline:N`) and call
again, once. An error naming no input (the repo is not registered with rt,
`mr` on no known forge) gets one unchanged call, never a script or the
GitLab CLI.

### Off-script gate: ci_watch refused

`context` quotes both errors. Take: the human reads the pipeline and
reports green or red for the pushed sha. Budget: `ci-watch-off-script`.

### Fix what the claim error names (GitHub)

Correct what the error names (`mrUrl` the PR's `.../pull/<n>` URL, `branch`
its source branch) and claim again, once; an error naming no input (no
session id) gets one unchanged claim.

### Off-script gate: ci_lease_claim refused (GitHub)

`context` quotes both errors. Take: the human attends the PR. Budget:
`github-claim-off-script`.

### Classify the triage report

`ci_triage` sorts failed jobs into REAL, INFRA or UNCLEAR by their logs and
marks each blocking one `yours`, INHERITED (also failing on the target
branch) or UNKNOWN (no base to compare); the `blocking` list decides the
verdict. Read each UNCLEAR job with `mr_job_trace`: the tail, then `grep`
for the failure text or `headLines`; a teardown-only tail (cleanup,
artifact upload, runner exit) says nothing about the cause. A
`crossProject` entry is read as the failedJobs section says. Then each
blocking failure is:

- REAL: the change broke it (a test, type or lint failure in touched code).
- INFRA: unrelated to the change (a runner, network or dependency outage, a
  known flake).
- UNCLEAR, still, after the read: it goes to the gate.

No failure is classified before its log is read, and never INFRA without
it; an unreadable trace is UNCLEAR. The domain rules judge the report
(which jobs block, which patterns are noise, whose failure it is) and may
move a job between REAL and INFRA. INHERITED goes to the gate, named as
inherited, never retried or fixed here; UNKNOWN still gets its one INFRA
retry. This box only classifies: INFRA job ids go to `mr_retry`, and no
retry command a report prints is run.

### Classify each failure REAL or INFRA from failedJobs

`ci_triage` errored: quote it and classify `ci_watch`'s `failedJobs` as the
triage-report section says, ownership unknown. A job with no `traceTail`
(past the first five blocking), or a tail too short or teardown-only, is
read with `mr_job_trace` within this step.

Empty `failedJobs` on a `failed` pipeline likely means a cross-project
downstream pipeline (same-project downstream jobs are already listed):
read `projects/:id/pipelines/<pipelineId>/bridges` with `gitlab_get` for
the downstream pipeline, its jobs, then the failed job's
`projects/<downstream project id>/jobs/<jobId>/trace` (`mr_job_trace`
reads only this project). `gitlab_get` returns at most 256 KiB, so a log
whose end is out of reach stays unclear, never INFRA. Other pipelines on
the branch are read with `pipeline_list`, a pipeline's jobs with
`pipeline_jobs`.

### Classify each failing check REAL or INFRA

Read the failing checks' logs from the links `gh pr checks <mr>` prints and
classify as the triage-report section says, ownership unknown.

### Off-script gate: mr_retry refused

`mr_retry` errored (`lease_held` is the stand-down). `context` quotes the
error and job ids. Take: the human retried the job. Budget:
`retry-off-script`.

### Off-script gate: ci_lease_claim refused (before the GitHub retry)

The re-claim before `gh run rerun` errored. Take: the human reran the job.
Budget: `retry-off-script`, shared with the `mr_retry` gate.

### Reading a GitLab fact no read tool returns

Read it with `gitlab_get {repoName, path}`: `repoName` this worktree,
`path` relative to the API root with `:id` for this project
(`projects/:id/jobs/<jobId>`). The read is part of the step, not an
off-script move. Quote a GitLab error as written; its refusal of a
credential path is final.

## What the graph cannot show

- **The pushed sha.** The ship stage writes `pushed` = `{"sha",
  "priorPipelineId"}` after its push. Only a `pushed.sha` equal to HEAD is
  watched with that prior id; otherwise HEAD is watched with none.
  `<sha12>` is the watched sha's first 12 characters.
- **The prior pipeline id** goes on the first `ci_watch` for a sha; the
  tool keeps it, and a `priorPipelineId` a result carries goes on the next
  call. The watched pipeline's own `pipeline.id` is never a prior id.
- **The tool owns the watch budget.** `ci_watch {attend: true}` keeps the
  window against `ci.watch.budgetMinutes` and ends `call again` with
  `timeout`, or `no_pipeline` after 10 minutes without one. Pass no budget
  arguments; count nothing.
- **The sha guard.** On GitLab `ci_watch` counts only a pipeline for `sha`
  and returns `superseded` when the head moves past it. On GitHub,
  `headRefOid` must equal the watched sha, and "no checks reported" is
  pending, not red.
- **Retry on GitHub.** The run id for `gh run rerun` is in the failed
  check's link from `gh pr checks <mr>`.
- **Hold.** `run_hold` takes the gate as `reason` and `decidedBy` as the
  answer recorded it.

## The attendant lease

One actor attends an MR's CI at a time: this stage, a standalone watch-ci
session, or the board's doctor. On GitLab, `ci_watch {attend: true}` is the
only claimer: it claims this session's lease, heartbeats every poll,
re-claims a vanished lease twice per commit, and a keepalive holds it
between calls (a gate's wait included) until `ci_lease_release`, another
owner, or 60 minutes with no attending CI call. Another owner's fresh lease
(the doctor's included) returns `stood_down` with `holder`. Never pass
`underBoardLease`. `mr_retry` with `leaseMrUrl: <mr>` takes a lapsed lease
back, or refuses with `refused: "lease_held"` and `holder`. On GitHub,
`unsupported_forge` comes before any claim: claim with `ci_lease_claim`,
heartbeat once per poll, re-claim before `gh run rerun`.

Every exit that knows the MR calls `ci_lease_release`, except Fix and
re-push, which keeps it for the re-run. The stand-down never releases and
writes no `ci`: report the `holder` and stop, because that lease is someone
else's.

| Thought | Reality |
|---|---|
| "The doctor's on it, but I can fix or retry faster" | A repair is the lease holder's. Stand down and stop. |
| "I'll heartbeat or claim by hand" | The keepalive and the `leaseMrUrl` guard cover it; on GitLab only `ci_watch` claims. |
| "A ci_watch error or lease_unavailable, so a script or the GitLab CLI" | Fix the input once, then the off-script gate. |
| "The pipeline says success, that's green" | Only for the watched sha. |

## Budgets in this stage

Every loop counts through `run_budget` with `stage: watch-ci`: each call
adds one as the loop is entered, and the diamond after it reads `spent >
limit`. `infra-retries` is read with `increment: 0` (`exhausted`) where a
retry is decided and counted once just before it runs, so a retry never run
is never spent.

| Key | Limit | Scope |
|---|---|---|
| `watch-ci:ci-watch-errors:<sha12>` | 1 | per commit |
| `watch-ci:ci-watch-off-script` | 1 | stage |
| `watch-ci:lease-rounds:<sha12>` | 2 | per commit |
| `watch-ci:infra-retries:<sha12>` | 1 | per commit |
| `watch-ci:retry-off-script` | 1 | stage |
| `watch-ci:ci-gate-iterations` | 2 | stage |
| `watch-ci:mark-ready-iterations` | 1 | stage |
| `watch-ci:github-claim-errors` | 1 | stage |
| `watch-ci:github-claim-off-script` | 1 | stage |
| `watch-ci:github-polls:<sha12>` | 45 | per commit |
| `watch-ci:github-sha-waits:<sha12>` | 5 | per commit |

## Gate `ci` (red, timeout, or no pipeline)

Reached on red (REAL, UNCLEAR or INHERITED, or the INFRA retry spent),
`timeout`, `no_pipeline`, a canceled, skipped, manual, superseded or
aborted pipeline, no MR, a spent GitHub poll or sha-wait budget, or a
GitHub heartbeat error (quoted). On `no_pipeline` (ten minutes with no
pipeline for the sha), `pushed: false` means the MR head is `remoteSha`:
say ship first; `pushed: true` means no pipeline ran for it. Scope
`ci:watch-ci:<attempt>`. One sentence above the form: the verdict and a
one-line triage per blocking failure.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `action` (write-in) | **Fix and re-push (Recommended)** (a REAL failure in your change; from the third one in a run the suffix moves to **Hand back**) / **Retry the job** (a flake not yet retried) / **Hand back** (leave it red for the human) / **Abandon the run** | always |
| `next` | **Proceed** / **Iterate here** / **Go back to `<stage>`** / **Hold** | always |

Selection: `{"next":"fix|retry|handback|abandon|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.
An `action` write-in adds `"action": {"writeIn": "<their words>"}`, and
`next` records `iterate`, or the deliberate `next` pick (Hold or Go back)
that won. Iterate counts one `ci-gate-iterations` round: the first two
reopen the gate with the note, and the third hands back.

## Gate `mark-ready` (green, `mr` set, still a draft)

One sentence above the form: CI is green for the MR's head, and whether
`evidence` is set.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `ready` (write-in) | **Mark ready now (Recommended)** (when `evidence` is set and not `-`) / **Keep it draft** | always |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage, split `to-1`, ... over 4 | Go back answered and more than one earlier stage row |

Selection: `{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.
Iterate counts one `mark-ready-iterations` round: the first opens a new
gate with the note, and the second keeps it draft.

## Domain rules

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

The domain supplies triage (how to read a red, REAL or INFRA, ownership,
noise), judged at `Classify the triage report`. It never watches, claims,
releases, retries or pushes. The slot contract stays `watch-ci-domain@1`.
A rule that runs `<scripts>/ci-triage.sh` is the move `STOP: GitLab triage
goes through ci_triage` redirects: call `ci_triage` with `pipelineId: <N>`
(never the ref's newest pipeline) and its `--config` file's keys as
`config` (the file sits under `parts/domain/`). `<forge> jobs` goes to
`pipeline_jobs`; `ci-attendant.sh` or `ci-watch.sh` to `ci_watch`.

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
