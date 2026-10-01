---
name: stage-watch-ci
description: "Pipeline stage: watch the pipeline the ship stage triggered and triage a red result. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: watch-ci-domain@1, required: false }
  forge: { contract: ci-forge@1, required: false }
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/ci-triage.sh:*), Bash(*/scripts/ci-forge.sh:*)
metadata:
  stage: "watch-ci"
  stage-consumes: "mr branch"
  stage-produces: "ci"
---

# stage: watch-ci

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read consumes with `run_field_get`,
write `ci` with `run_field_set` (`stage: "watch-ci"`) once a verdict
exists, and on failure write `run_stage {action: fail, stage: "watch-ci",
reason, detailPath}` with `detailPath` = the triage report.

`<scripts>` is `{{stage.dir}}/scripts/` and `<forge>` is
`{{stage.dir}}/parts/forge/scripts/ci-forge.sh`: the triage script is
vendored beside this file, the forge adapter beside it. GitLab MR tools and
`ci_watch` take `repoName` = this worktree's absolute path and `iid` = the
iid in `mr`; the lease tools take `mrUrl` = `mr`'s https URL. `Which forge
watches?` reads `mr`'s host: a `/-/merge_requests/` URL is GitLab, a
`/pull/` URL is GitHub, anything else is the clarify gate.

```dot
digraph watch_ci {
    rankdir=TB;

    "Watch-ci stage entered" [shape=ellipse];
    "run_field_get {key: mr}" [shape=plaintext];
    "run_field_get {key: branch}" [shape=plaintext];
    "mr set?" [shape=diamond];
    "ci_lease_claim {mrUrl: <mr>, branch}" [shape=plaintext];
    "claim result?" [shape=diamond];
    "STOP: claim the lease only with ci_lease_claim" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Fixed the claim call once already?" [shape=diamond];
    "Fix what the claim error names (stage)" [shape=box];
    "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Stand down: report it and stop (stage)" [shape=doublecircle];
    "Off-script gate: ci_lease_claim refused (gate-protocol, scope off-script:watch-ci:<n>)" [shape=box];
    "off-script answer (ci_lease_claim)?" [shape=diamond];
    "Off-script rounds = 2 (ci_lease_claim, stage)?" [shape=diamond];
    "Off-script gate: re-claim refused before the retry (gate-protocol, scope off-script:watch-ci:<n>)" [shape=box];
    "off-script answer (re-claim before the retry)?" [shape=diamond];
    "Off-script rounds = 2 (re-claim before the retry, stage)?" [shape=diamond];
    "git rev-parse HEAD (the pushed sha)" [shape=plaintext];
    "Which forge watches?" [shape=diamond];
    "Gate clarify: which forge?" [shape=box];

    "ci_watch {repoName, iid, sha, priorPipelineId?, extendMinutes?, budgetMinutes?}" [shape=plaintext];
    "ci_watch state?" [shape=diamond];
    "STOP: GitLab CI watches go through ci_watch, reads and retries through mr_job_trace and mr_retry, never the GitLab CLI" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "budget.spent?" [shape=diamond];
    "Waiting results in a row = 2?" [shape=diamond];
    "Re-claims after a lost lease = 2?" [shape=diamond];
    "Verify the branch was pushed (stage)" [shape=box];
    "Fixed the ci_watch call once already?" [shape=diamond];
    "Fix what the ci_watch error names (stage)" [shape=box];
    "Off-script gate: ci_watch refused (gate-protocol, scope off-script:watch-ci:<n>)" [shape=box];
    "off-script answer (ci_watch)?" [shape=diamond];
    "Verdict the human reported?" [shape=diamond];
    "Off-script rounds = 2 (ci_watch, stage)?" [shape=diamond];

    "gh pr checks <mr> (stage poll)" [shape=plaintext];
    "gh pr checks exit?" [shape=diamond];
    "Polled 45 minutes?" [shape=diamond];
    "ci_lease_heartbeat {mrUrl: <mr>} (stage poll)" [shape=plaintext];
    "Heartbeat result?" [shape=diamond];
    "sleep 60 as a background Bash task (stage poll)" [shape=plaintext];
    "gh pr view <mr> --json headRefOid (stage sha guard)" [shape=plaintext];
    "Checks are for the pushed sha?" [shape=diamond];
    "Sha waits = 5?" [shape=diamond];
    "sleep 60 as a background Bash task (stage sha wait)" [shape=plaintext];
    "Checks passed or failed?" [shape=diamond];

    "Triage with what?" [shape=diamond];
    "Triage with the domain's rules (stage)" [shape=box];
    "<scripts>/ci-triage.sh --forge <forge> --pipeline <N> (stage)" [shape=plaintext];
    "Read the triage report (stage)" [shape=box];
    "Trace tails enough to classify?" [shape=diamond];
    "mr_job_trace {repoName, iid, jobId} per failed job (stage)" [shape=plaintext];
    "Classify each failure REAL or INFRA" [shape=box];
    "Classify each failing check REAL or INFRA" [shape=box];
    "Only INFRA blocking failures, none retried yet?" [shape=diamond];
    "ci_lease_claim {mrUrl: <mr>, branch} (before the retry)" [shape=plaintext];
    "Re-claim result (before the retry, stage)?" [shape=diamond];
    "Retry on which forge?" [shape=diamond];
    "mr_retry {repoName, iid, jobId} per INFRA job (stage)" [shape=plaintext];
    "gh run rerun <run-id> --failed (stage)" [shape=plaintext];

    "Gate ci (table below)" [shape=box];
    "ci answer?" [shape=diamond];
    "ci gate iterations = 3?" [shape=diamond];
    "Retried the failed job once already?" [shape=diamond];
    "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [shape=plaintext];
    "run_status {status: abandoned}" [shape=plaintext];
    "Forge host (stage draft check)?" [shape=diamond];
    "mr_view {repoName, iid, maxAgeMs: 5000}" [shape=plaintext];
    "gh pr view <mr> --json isDraft" [shape=plaintext];
    "MR still a draft?" [shape=diamond];
    "Gate mark-ready (table below)" [shape=box];
    "ready answer?" [shape=diamond];
    "mark-ready iterations = 2?" [shape=diamond];
    "Forge host (stage mark-ready)?" [shape=diamond];
    "mr_ready {repoName, iid}" [shape=plaintext];
    "gh pr ready <number>" [shape=plaintext];
    "run_field_set {key: ci, value: green, stage: watch-ci}" [shape=plaintext];
    "Was a lease claimed?" [shape=diamond];
    "ci_lease_release {mrUrl: <mr>}" [shape=plaintext];
    "Which exit is this?" [shape=diamond];
    "run_stage {action: fail, stage: watch-ci, reason}" [shape=plaintext];
    "run_decision {contract: gate@1, scope: hold:watch-ci:<attempt>, selection: {reason}, decidedBy}" [shape=plaintext];
    "run_field_set {key: hold, value: <their words, or held>, stage: watch-ci}" [shape=plaintext];
    "Stage failed" [shape=doublecircle];
    "Hand Fix and re-push to the orchestrator: Redirect to implement" [shape=doublecircle];
    "Hand the Go back answer to the orchestrator" [shape=doublecircle];
    "Held: end the turn naming run and stage" [shape=doublecircle];
    "Run abandoned" [shape=doublecircle];
    "Watch-ci done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Watch-ci stage entered" -> "run_field_get {key: mr}";
    "run_field_get {key: mr}" -> "run_field_get {key: branch}";
    "run_field_get {key: branch}" -> "mr set?";
    "mr set?" -> "ci_lease_claim {mrUrl: <mr>, branch}" [label="yes"];
    "mr set?" -> "Gate ci (table below)" [label="no: reason is no MR to watch, ship first"];
    "ci_lease_claim {mrUrl: <mr>, branch}" -> "claim result?";
    "claim result?" -> "git rev-parse HEAD (the pushed sha)" [label="claimed: true, the MR is yours"];
    "claim result?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="claimed: false, holder named"];
    "claim result?" -> "Fixed the claim call once already?" [label="tool error"];
    "claim result?" -> "STOP: claim the lease only with ci_lease_claim" [label="tempted to write the lease by hand or with a script"];
    "STOP: claim the lease only with ci_lease_claim" -> "ci_lease_claim {mrUrl: <mr>, branch}";
    "Fixed the claim call once already?" -> "Fix what the claim error names (stage)" [label="no"];
    "Fixed the claim call once already?" -> "Off-script gate: ci_lease_claim refused (gate-protocol, scope off-script:watch-ci:<n>)" [label="yes"];
    "Fix what the claim error names (stage)" -> "ci_lease_claim {mrUrl: <mr>, branch}";
    "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" -> "Stand down: report it and stop (stage)";
    "git rev-parse HEAD (the pushed sha)" -> "Which forge watches?";
    "Which forge watches?" -> "ci_watch {repoName, iid, sha, priorPipelineId?, extendMinutes?, budgetMinutes?}" [label="GitLab"];
    "Which forge watches?" -> "gh pr checks <mr> (stage poll)" [label="GitHub"];
    "Which forge watches?" -> "Gate clarify: which forge?" [label="anything else"];
    "Gate clarify: which forge?" -> "Which forge watches?" [label="answered: the named forge"];

    "ci_watch {repoName, iid, sha, priorPipelineId?, extendMinutes?, budgetMinutes?}" -> "ci_watch state?";
    "ci_watch state?" -> "budget.spent?" [label="running"];
    "ci_watch state?" -> "Waiting results in a row = 2?" [label="waiting"];
    "ci_watch state?" -> "Forge host (stage draft check)?" [label="success or success_with_warnings"];
    "ci_watch state?" -> "Triage with what?" [label="failed"];
    "ci_watch state?" -> "Gate ci (table below)" [label="canceled, skipped, manual, superseded or aborted"];
    "ci_watch state?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="lease_lost, holder named"];
    "ci_watch state?" -> "Re-claims after a lost lease = 2?" [label="lease_lost, no holder: no lease held"];
    "Re-claims after a lost lease = 2?" -> "ci_lease_claim {mrUrl: <mr>, branch}" [label="no: claim it again"];
    "Re-claims after a lost lease = 2?" -> "Gate ci (table below)" [label="yes: the lease keeps vanishing"];
    "ci_watch state?" -> "Fixed the ci_watch call once already?" [label="tool error"];
    "ci_watch state?" -> "STOP: GitLab CI watches go through ci_watch, reads and retries through mr_job_trace and mr_retry, never the GitLab CLI" [label="tempted to watch with a script or the GitLab CLI"];
    "STOP: GitLab CI watches go through ci_watch, reads and retries through mr_job_trace and mr_retry, never the GitLab CLI" -> "ci_watch {repoName, iid, sha, priorPipelineId?, extendMinutes?, budgetMinutes?}";
    "budget.spent?" -> "ci_watch {repoName, iid, sha, priorPipelineId?, extendMinutes?, budgetMinutes?}" [label="false: call again"];
    "budget.spent?" -> "Gate ci (table below)" [label="true: timeout"];
    "Waiting results in a row = 2?" -> "ci_watch {repoName, iid, sha, priorPipelineId?, extendMinutes?, budgetMinutes?}" [label="no: call again"];
    "Waiting results in a row = 2?" -> "Verify the branch was pushed (stage)" [label="yes: no pipeline for the sha"];
    "Verify the branch was pushed (stage)" -> "Gate ci (table below)";
    "Fixed the ci_watch call once already?" -> "Fix what the ci_watch error names (stage)" [label="no"];
    "Fixed the ci_watch call once already?" -> "Off-script gate: ci_watch refused (gate-protocol, scope off-script:watch-ci:<n>)" [label="yes"];
    "Fix what the ci_watch error names (stage)" -> "ci_watch {repoName, iid, sha, priorPipelineId?, extendMinutes?, budgetMinutes?}";
    "Off-script gate: ci_watch refused (gate-protocol, scope off-script:watch-ci:<n>)" -> "off-script answer (ci_watch)?";
    "off-script answer (ci_watch)?" -> "Verdict the human reported?" [label="take: the human read the pipeline"];
    "off-script answer (ci_watch)?" -> "Off-script rounds = 2 (ci_watch, stage)?" [label="iterate: the human fixed it"];
    "off-script answer (ci_watch)?" -> "Was a lease claimed?" [label="hold"];
    "off-script answer (ci_watch)?" -> "Was a lease claimed?" [label="hand back: a failure, the refusal is the reason"];
    "Verdict the human reported?" -> "Forge host (stage draft check)?" [label="green for the pushed sha"];
    "Verdict the human reported?" -> "Gate ci (table below)" [label="red, or not for the pushed sha"];
    "Off-script rounds = 2 (ci_watch, stage)?" -> "ci_watch {repoName, iid, sha, priorPipelineId?, extendMinutes?, budgetMinutes?}" [label="no: watch again"];
    "Off-script rounds = 2 (ci_watch, stage)?" -> "Was a lease claimed?" [label="yes: a failure, the refusals are the reason"];

    "gh pr checks <mr> (stage poll)" -> "gh pr checks exit?";
    "gh pr checks exit?" -> "gh pr view <mr> --json headRefOid (stage sha guard)" [label="0, or any other exit with checks reported: passed or failed"];
    "gh pr checks exit?" -> "Polled 45 minutes?" [label="8, or no checks reported: pending"];
    "Polled 45 minutes?" -> "ci_lease_heartbeat {mrUrl: <mr>} (stage poll)" [label="no"];
    "Polled 45 minutes?" -> "Gate ci (table below)" [label="yes: timeout"];
    "ci_lease_heartbeat {mrUrl: <mr>} (stage poll)" -> "Heartbeat result?";
    "Heartbeat result?" -> "sleep 60 as a background Bash task (stage poll)" [label="ok: true"];
    "Heartbeat result?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="lost"];
    "Heartbeat result?" -> "ci_lease_claim {mrUrl: <mr>, branch}" [label="none: claim it again"];
    "Heartbeat result?" -> "Gate ci (table below)" [label="tool error"];
    "sleep 60 as a background Bash task (stage poll)" -> "gh pr checks <mr> (stage poll)";
    "gh pr view <mr> --json headRefOid (stage sha guard)" -> "Checks are for the pushed sha?";
    "Checks are for the pushed sha?" -> "Checks passed or failed?" [label="yes"];
    "Checks are for the pushed sha?" -> "Sha waits = 5?" [label="no"];
    "Sha waits = 5?" -> "sleep 60 as a background Bash task (stage sha wait)" [label="no"];
    "Sha waits = 5?" -> "Gate ci (table below)" [label="yes: no checks for the pushed sha"];
    "sleep 60 as a background Bash task (stage sha wait)" -> "gh pr checks <mr> (stage poll)";
    "Checks passed or failed?" -> "Forge host (stage draft check)?" [label="passed"];
    "Checks passed or failed?" -> "Triage with what?" [label="failed"];

    "Triage with what?" -> "Triage with the domain's rules (stage)" [label="domain rules inlined"];
    "Triage with what?" -> "<scripts>/ci-triage.sh --forge <forge> --pipeline <N> (stage)" [label="forge bound, no domain"];
    "Triage with what?" -> "Trace tails enough to classify?" [label="neither, GitLab"];
    "Triage with what?" -> "Classify each failing check REAL or INFRA" [label="neither, GitHub"];
    "Triage with the domain's rules (stage)" -> "Only INFRA blocking failures, none retried yet?";
    "<scripts>/ci-triage.sh --forge <forge> --pipeline <N> (stage)" -> "Read the triage report (stage)";
    "Read the triage report (stage)" -> "Only INFRA blocking failures, none retried yet?";
    "Trace tails enough to classify?" -> "Classify each failure REAL or INFRA" [label="yes"];
    "Trace tails enough to classify?" -> "mr_job_trace {repoName, iid, jobId} per failed job (stage)" [label="no"];
    "mr_job_trace {repoName, iid, jobId} per failed job (stage)" -> "Classify each failure REAL or INFRA";
    "Classify each failure REAL or INFRA" -> "Only INFRA blocking failures, none retried yet?";
    "Classify each failing check REAL or INFRA" -> "Only INFRA blocking failures, none retried yet?";
    "Only INFRA blocking failures, none retried yet?" -> "ci_lease_claim {mrUrl: <mr>, branch} (before the retry)" [label="yes"];
    "Only INFRA blocking failures, none retried yet?" -> "Gate ci (table below)" [label="no: a REAL or unclassified failure, or retried already"];
    "ci_lease_claim {mrUrl: <mr>, branch} (before the retry)" -> "Re-claim result (before the retry, stage)?";
    "Re-claim result (before the retry, stage)?" -> "Retry on which forge?" [label="claimed: true"];
    "Re-claim result (before the retry, stage)?" -> "STOP: while another attendant holds the lease, every commit, push and retry is theirs (stage)" [label="claimed: false"];
    "Re-claim result (before the retry, stage)?" -> "Off-script gate: re-claim refused before the retry (gate-protocol, scope off-script:watch-ci:<n>)" [label="tool error"];
    "Off-script gate: ci_lease_claim refused (gate-protocol, scope off-script:watch-ci:<n>)" -> "off-script answer (ci_lease_claim)?";
    "off-script answer (ci_lease_claim)?" -> "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [label="take: the human attends the MR"];
    "off-script answer (ci_lease_claim)?" -> "Off-script rounds = 2 (ci_lease_claim, stage)?" [label="iterate: the human fixed it"];
    "off-script answer (ci_lease_claim)?" -> "Was a lease claimed?" [label="hold"];
    "off-script answer (ci_lease_claim)?" -> "Was a lease claimed?" [label="hand back: a failure, the refusal is the reason"];
    "Off-script rounds = 2 (ci_lease_claim, stage)?" -> "ci_lease_claim {mrUrl: <mr>, branch}" [label="no: claim again"];
    "Off-script rounds = 2 (ci_lease_claim, stage)?" -> "Was a lease claimed?" [label="yes: a failure, the refusals are the reason"];
    "Off-script gate: re-claim refused before the retry (gate-protocol, scope off-script:watch-ci:<n>)" -> "off-script answer (re-claim before the retry)?";
    "off-script answer (re-claim before the retry)?" -> "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [label="take: the human attends the MR"];
    "off-script answer (re-claim before the retry)?" -> "Off-script rounds = 2 (re-claim before the retry, stage)?" [label="iterate: the human fixed it"];
    "off-script answer (re-claim before the retry)?" -> "Was a lease claimed?" [label="hold"];
    "off-script answer (re-claim before the retry)?" -> "Was a lease claimed?" [label="hand back: a failure, the refusal is the reason"];
    "Off-script rounds = 2 (re-claim before the retry, stage)?" -> "ci_lease_claim {mrUrl: <mr>, branch} (before the retry)" [label="no: claim again"];
    "Off-script rounds = 2 (re-claim before the retry, stage)?" -> "Was a lease claimed?" [label="yes: a failure, the refusals are the reason"];

    "Retry on which forge?" -> "mr_retry {repoName, iid, jobId} per INFRA job (stage)" [label="GitLab"];
    "Retry on which forge?" -> "gh run rerun <run-id> --failed (stage)" [label="GitHub"];
    "mr_retry {repoName, iid, jobId} per INFRA job (stage)" -> "Which forge watches?";
    "gh run rerun <run-id> --failed (stage)" -> "Which forge watches?";

    "Gate ci (table below)" -> "ci answer?";
    "ci answer?" -> "Hand Fix and re-push to the orchestrator: Redirect to implement" [label="fix and re-push: write no ci"];
    "ci answer?" -> "Retried the failed job once already?" [label="retry the job"];
    "ci answer?" -> "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [label="hand back"];
    "ci answer?" -> "Was a lease claimed?" [label="abandon"];
    "ci answer?" -> "Was a lease claimed?" [label="go back"];
    "ci answer?" -> "Was a lease claimed?" [label="hold"];
    "ci answer?" -> "ci gate iterations = 3?" [label="iterate"];
    "ci gate iterations = 3?" -> "Gate ci (table below)" [label="no: re-triage with their note"];
    "ci gate iterations = 3?" -> "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" [label="yes: hand back"];
    "Retried the failed job once already?" -> "ci_lease_claim {mrUrl: <mr>, branch} (before the retry)" [label="no"];
    "Retried the failed job once already?" -> "ci gate iterations = 3?" [label="yes: reopen, the retry is spent"];
    "run_status {status: abandoned}" -> "Run abandoned";
    "Forge host (stage draft check)?" -> "mr_view {repoName, iid, maxAgeMs: 5000}" [label="GitLab"];
    "Forge host (stage draft check)?" -> "gh pr view <mr> --json isDraft" [label="GitHub"];
    "mr_view {repoName, iid, maxAgeMs: 5000}" -> "MR still a draft?";
    "gh pr view <mr> --json isDraft" -> "MR still a draft?";
    "MR still a draft?" -> "Gate mark-ready (table below)" [label="yes"];
    "MR still a draft?" -> "run_field_set {key: ci, value: green, stage: watch-ci}" [label="no"];
    "Gate mark-ready (table below)" -> "ready answer?";
    "ready answer?" -> "Forge host (stage mark-ready)?" [label="mark ready now"];
    "ready answer?" -> "run_field_set {key: ci, value: green, stage: watch-ci}" [label="keep it draft"];
    "ready answer?" -> "Was a lease claimed?" [label="go back"];
    "ready answer?" -> "Was a lease claimed?" [label="hold"];
    "ready answer?" -> "mark-ready iterations = 2?" [label="iterate"];
    "mark-ready iterations = 2?" -> "Gate mark-ready (table below)" [label="no: re-ask with their note"];
    "mark-ready iterations = 2?" -> "run_field_set {key: ci, value: green, stage: watch-ci}" [label="yes: keep it draft"];
    "Forge host (stage mark-ready)?" -> "mr_ready {repoName, iid}" [label="GitLab"];
    "Forge host (stage mark-ready)?" -> "gh pr ready <number>" [label="GitHub"];
    "mr_ready {repoName, iid}" -> "run_field_set {key: ci, value: green, stage: watch-ci}";
    "gh pr ready <number>" -> "run_field_set {key: ci, value: green, stage: watch-ci}";
    "run_field_set {key: ci, value: green, stage: watch-ci}" -> "Was a lease claimed?";
    "run_field_set {key: ci, value: red: <triage>, stage: watch-ci}" -> "Was a lease claimed?";
    "Was a lease claimed?" -> "ci_lease_release {mrUrl: <mr>}" [label="yes: mr was set and claimed"];
    "Was a lease claimed?" -> "Which exit is this?" [label="no: mr unset, or the claim never succeeded"];
    "ci_lease_release {mrUrl: <mr>}" -> "Which exit is this?";
    "Which exit is this?" -> "Watch-ci done: return to the orchestrator" [label="ci written"];
    "Which exit is this?" -> "run_decision {contract: gate@1, scope: hold:watch-ci:<attempt>, selection: {reason}, decidedBy}" [label="hold"];
    "run_decision {contract: gate@1, scope: hold:watch-ci:<attempt>, selection: {reason}, decidedBy}" -> "run_field_set {key: hold, value: <their words, or held>, stage: watch-ci}";
    "run_field_set {key: hold, value: <their words, or held>, stage: watch-ci}" -> "Held: end the turn naming run and stage";
    "Which exit is this?" -> "Hand the Go back answer to the orchestrator" [label="go back"];
    "Which exit is this?" -> "run_status {status: abandoned}" [label="abandon"];
    "Which exit is this?" -> "run_stage {action: fail, stage: watch-ci, reason}" [label="a failure, or an off-script hand back"];
    "run_stage {action: fail, stage: watch-ci, reason}" -> "Stage failed";
}
```

### Fix what the claim error names (stage)

`ci_lease_claim` refused its input. Correct what the error names (`mrUrl`
must be the MR's https URL, `.../-/merge_requests/<iid>` or `.../pull/<n>`;
`branch` the MR's source branch) and claim again, once.
An error that names none of these inputs (no session id, for example) has
nothing to correct: claim again unchanged, once, and the off-script gate
follows.

### Off-script gate: ci_lease_claim refused (gate-protocol, scope off-script:watch-ci:<n>)

`context` quotes both errors. Answers: **Take** (the human attends this MR
themselves: `ci` is written red with the lease error as the triage line) /
**Iterate** (the human fixed it, for example the session id or the URL:
claim again, through `Off-script rounds = 2`) / **Hold** / **Hand back** (a
failure, the refusal is the reason).

### Off-script gate: re-claim refused before the retry (gate-protocol, scope off-script:watch-ci:<n>)

The re-claim before a job retry failed with a tool error. `context` quotes
it. Same four answers as the claim gate above; Iterate re-claims before the
retry.

### Fix what the ci_watch error names (stage)

`ci_watch` refused its input. Correct what the error names (`repoName` the
worktree's absolute path, `iid` a number, `sha` 7 to 40 hex characters,
`priorPipelineId` the number `N` of a `gitlab:pipeline:N` id) and call
again, once. An error is never a reason to watch with a script or the
GitLab CLI. An error that names none of these inputs (the repo is not
registered with rt, for example) has nothing to correct: call again
unchanged, once, and the off-script gate follows.

### Off-script gate: ci_watch refused (gate-protocol, scope off-script:watch-ci:<n>)

`context` quotes both errors. Answers: **Take** (the human reads the
pipeline and reports green or red for the pushed sha) / **Iterate** (the
human fixed it, for example registered the repo with rt: watch again,
through `Off-script rounds = 2`) / **Hold** / **Hand back** (a failure, the
refusal is the reason).

### Verify the branch was pushed (stage)

Two `ci_watch` calls in a row returned `waiting`: no pipeline exists for
the pushed sha. Compare `git
rev-parse HEAD` with the remote branch. Unpushed: the `ci` gate says "ship
first". Pushed: the `ci` gate says no pipeline ran for that sha.

### Gate clarify: which forge?

`mr` is neither a GitLab nor a GitHub MR URL. Ask which forge it is,
quoting `mr` as the context.

### Triage with the domain's rules (stage)

The domain rules below say how to read this red: REAL or INFRA, whether the
failure is this branch's or inherited, which jobs block. Where they run
`ci-triage.sh`, pass `--pipeline <N>`, the number `N` in `ci_watch`'s
`pipeline.id` (`gitlab:pipeline:N`), never `--ref` (the newest pipeline for
the ref, not the pushed sha). The box classifies and nothing else: no
claim, no watch, no retry, no push inside it.

### Read the triage report (stage)

`ci-triage.sh --pipeline <N>` prints one verdict per blocking failure (REAL
or INFRA) with its job id. `<N>` is the number in `ci_watch`'s
`pipeline.id` on GitLab, and the run id from the failing check's link on
GitHub. A script that fails instead of reporting: quote its output and
classify from `failedJobs` as the unbound flow does, including its rule
for blocking failures `failedJobs` does not return. INFRA job ids go to
`mr_retry` (GitLab) or `gh run rerun` (GitHub); the adapter's printed
retry command is not run.

### Classify each failing check REAL or INFRA

Read the failing checks' logs from the links `gh pr checks <mr>` prints,
then classify as for GitLab: REAL goes to the gate, INFRA gets one retry.

### Classify each failure REAL or INFRA

Read each failed job's `traceTail` in `ci_watch`'s `failedJobs` first;
`mr_job_trace` is for a tail too short to classify. REAL: the change broke
it (a test, type or lint failure in touched code). INFRA: unrelated to the
change (a runner, network or dependency outage, a known flake). One retry
per INFRA job; a REAL failure goes to the gate.

`ci_watch` details at most five blocking failures. When `blockingFailures`
is larger than the blocking jobs in `failedJobs`, the rest are
unclassified, so the red is not INFRA only: answer no at `Only INFRA
blocking failures, none retried yet?` and let the `ci` gate name the
count.

## The attendant lease

Exactly one actor attends an MR's CI at a time: this stage, a standalone
watch-ci session, or the board's doctor. The `ci_lease_*` tools own the
lease; the owner is this session, so any other fresh lease (a doctor or
another watch-ci session) refuses the claim. `ci_watch` heartbeats on every
poll and returns `lease_lost` the moment someone else holds the MR; the
GitHub poll heartbeats with `ci_lease_heartbeat`. A `lease_lost` with no
`holder` means no lease is held at all (its `next` says to claim first):
claim again, twice at most, never a stand-down. A lease with no heartbeat
goes stale after 10 minutes (`ttlSeconds` 600) and may then be taken over.
A crashed session needs no cleanup.

Release it with `ci_lease_release` on every exit that leaves the MR
unattended (a written `ci`, Hold, Go back, Abandon, a failure); with `mr`
unset nothing was claimed. Fix and re-push keeps it, because the re-run
claims it again. The stand-down never touches it: that lease is someone
else's.

`budget.spent?` reads the `budget` field of a `running` result: `ci_watch`
measures it from the pipeline's own start against the
`ci.watch.budgetMinutes` setting, so there are no calls to count. A job
retry keeps the pipeline's start, so after one pass `extendMinutes` (the
last result's `budget.minutes`) until a result carries a non-null
`budget`, then that result's `budget.minutes` as `budgetMinutes` on every
later call for the sha.
`Waiting results in a row = 2?` counts consecutive `waiting` results (their
`budget` is null); any other state resets it, and so does a new pushed sha
or a job retry. The stage has no prior
pipeline id: pass `priorPipelineId` only when a `ci_watch` result itself
returns a `priorPipelineId` field, and pass that field's value. The watched
pipeline's own `pipeline.id` is never a prior id.

| Thought | Reality |
|---|---|
| "The doctor's on it, but I can fix it faster" | Two actors pushing to one branch race each other's work. Stand down. |
| "I'll just retry the flaky job while the doctor works" | A retry is a repair action. The lease holder does it, not you. |
| "The claim tool errored, so I'll run the attendant script" | The script is retired. Fix the input once, then the off-script gate. |
| "ci_watch errored, so I'll poll with the GitLab CLI or a watch script" | Fix the input once, then the off-script gate. The STOP on `ci_watch state?` names it. |
| "The pipeline says success, that's green" | `ci_watch` only reports a pipeline for the pushed sha. A green read any other way is not the verdict. |

## Gate `ci` (red, timeout, or no pipeline)

Scope `ci:watch-ci:<attempt>`. One sentence above the form: the verdict
and a one-line triage per blocking failure. A `ci_lease_heartbeat` tool
error also reaches it, quoted in the sentence above the form.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `action` | **Fix and re-push** (a REAL failure in your change; from the third one in a run, **Hand back** is recommended instead) / **Retry the job** (a flake not yet retried) / **Hand back** (leave it red for the human) / **Abandon the run** | always |
| `next` | **Proceed** / **Iterate here** / **Go back to `<stage>`** / **Hold** | always |

Selection: `{"next":"fix|retry|handback|abandon|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.
Retry: `mr_retry` per INFRA job id on GitLab, `gh run rerun <run-id>
--failed` on GitHub (the run id from the failed check's link in `gh pr
checks <mr>`), after the re-claim.

## Gate `mark-ready` (green, `mr` set, still a draft)

One sentence above the form: CI is green for the MR's head, and whether
`evidence` is set.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `ready` | **Mark ready now** (when `evidence` is set and not `-`) / **Keep it draft** | always |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage, split `to-1`, ... over 4 | Go back answered and more than one earlier stage row |

Selection: `{"ready":true|false,"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}`.

## Domain rules

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

The domain supplies triage: how to read a red, REAL or INFRA, ownership,
noise. It never watches, claims, releases or pushes; the graph does.

The slot contract stays `watch-ci-domain@1`. A fill written for the
script-based engine still compiles: its text may name `ci-attendant.sh` and
`ci-watch.sh`, which this skill no longer vendors, and may triage with
`--ref`. The STOPs on `claim result?` and `ci_watch state?` redirect those
moves to `ci_lease_claim` and `ci_watch`; triage with `--pipeline <N>`.

{{slot:domain}}

When nothing is inlined above, the graph's other flows apply.

## Forge

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

{{slot:forge}}

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
