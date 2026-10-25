---
name: stage-self-review
description: "Pipeline stage: fresh-eyes review of the unit of work before it ships. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "self-review"
  stage-consumes: "commits"
  stage-produces: "review"
replaced-slots: [domain]
---

# stage: self-review

{{stage.fields}}

The orchestrator owns this stage's rows: read consumes with
`run_field_get`, write produces with `run_field_set {stage:
"self-review"}`, and end a failure with `run_stage {action: fail, stage:
"self-review", reason}`.

```mermaid
flowchart TB
%% name: self_review
    self_review_entered([Self-review stage entered])
    run_field_get_commits[/"run_field_get {key: commits}"/]
    domain_rules_inlined{Any domain rule inlined in this stage?}
    dispatch_reviewer
    blocking_findings{Blocking findings?}
    run_budget_review_rounds[/"run_budget {key: review-rounds, limit: 3, stage: self-review}"/]
    review_rounds_spent{Review rounds = 3?}
    fix_blocking_findings
    follow_domain_review
    domain_review_gated{How did the domain review's own gate end?}
    git_log_shas[/git log --format=%h <branch-point>..HEAD/]
    run_field_set_commits[/"run_field_set {key: commits, value: <all shas, fixes included>, stage: self-review}"/]
    run_field_set_review[/"run_field_set {key: review, value: <verdict; findings fixed, waived, or left open by name>, stage: self-review}"/]
    run_stage_fail[/"run_stage {action: fail, stage: self-review, reason: blocking findings after 3 rounds}"/]
    stage_failed(((Stage failed)))
    held_domain_gate(((Held at the domain review's gate)))
    self_review_done(((Self-review done: return to the orchestrator))):::done
    self_review_entered --> run_field_get_commits
    run_field_get_commits --> domain_rules_inlined
    domain_rules_inlined -->|yes| follow_domain_review
    domain_rules_inlined -->|no| dispatch_reviewer
    follow_domain_review --> domain_review_gated
    domain_review_gated -->|answered: it stands, open findings named| run_field_set_review
    domain_review_gated -->|no gate ran| blocking_findings
    domain_review_gated -->|hold| held_domain_gate
    domain_review_gated -->|abandon: it failed the stage| stage_failed
    dispatch_reviewer --> blocking_findings
    blocking_findings -->|no| run_field_set_review
    blocking_findings -->|yes| run_budget_review_rounds
    run_budget_review_rounds --> review_rounds_spent
    review_rounds_spent -->|no: not exhausted| fix_blocking_findings
    review_rounds_spent -->|yes: exhausted, or a budget error| run_stage_fail
    fix_blocking_findings --> git_log_shas
    git_log_shas --> run_field_set_commits
    run_field_set_commits -->|review again| domain_rules_inlined
    run_field_set_review --> self_review_done
    run_stage_fail --> stage_failed
```
