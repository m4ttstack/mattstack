---
name: stage-self-review
description: "Pipeline stage: fresh-eyes review of the unit of work before it ships. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: self-review-domain@1, required: false }
metadata:
  stage: "self-review"
  stage-consumes: "commits"
  stage-produces: "review"
---

# stage: self-review

{{stage.fields}}

The orchestrator owns this stage's rows: read consumes with
`run_field_get`, write produces with `run_field_set {stage:
"self-review"}`, and end a failure with `run_stage {action: fail, stage:
"self-review", reason}`.

```dot
digraph self_review {
    rankdir=TB;

    self_review_entered [label="Self-review stage entered" shape=ellipse];
    run_field_get_commits [label="run_field_get {key: commits}" shape=plaintext];
    domain_rules_inlined [label="Domain rules inlined?" shape=diamond];
    follow_domain_review [label="Follow the domain review" shape=box];
    dispatch_reviewer [label="Dispatch one fresh-context reviewer over the diff" shape=box];
    blocking_findings [label="Blocking findings?" shape=diamond];
    run_budget_review_rounds [label="run_budget {key: review-rounds, limit: 3, stage: self-review}" shape=plaintext];
    review_rounds_spent [label="Review rounds = 3?" shape=diamond];
    fix_blocking_findings [label="Fix each blocking finding test-first, commit" shape=box];
    git_log_shas [label="git log --format=%h <branch-point>..HEAD" shape=plaintext];
    run_field_set_commits [label="run_field_set {key: commits, value: <all shas, fixes included>, stage: self-review}" shape=plaintext];
    run_field_set_review [label="run_field_set {key: review, value: <verdict; findings fixed or waived>, stage: self-review}" shape=plaintext];
    run_stage_fail [label="run_stage {action: fail, stage: self-review, reason: blocking findings after 3 rounds}" shape=plaintext];
    stage_failed [label="Stage failed" shape=doublecircle];
    self_review_done [label="Self-review done: return to the orchestrator" shape=doublecircle style=filled fillcolor=lightgreen];

    self_review_entered -> run_field_get_commits;
    run_field_get_commits -> domain_rules_inlined;
    domain_rules_inlined -> follow_domain_review [label="yes"];
    domain_rules_inlined -> dispatch_reviewer [label="no"];
    follow_domain_review -> blocking_findings;
    dispatch_reviewer -> blocking_findings;
    blocking_findings -> run_field_set_review [label="no"];
    blocking_findings -> run_budget_review_rounds [label="yes"];
    run_budget_review_rounds -> review_rounds_spent;
    review_rounds_spent -> fix_blocking_findings [label="no: not exhausted"];
    review_rounds_spent -> run_stage_fail [label="yes: exhausted, or a budget error"];
    fix_blocking_findings -> git_log_shas;
    git_log_shas -> run_field_set_commits;
    run_field_set_commits -> domain_rules_inlined [label="review again"];
    run_field_set_review -> self_review_done;
    run_stage_fail -> stage_failed;
}
```

### Dispatch one fresh-context reviewer over the diff

The unbound review: one subagent reads `git diff <branch-point>..HEAD`
against the ticket or task description for correctness, tests present and
honest, and scope drift.

### Review rounds = 3?

Read `exhausted` from the `run_budget` call just made, which charges this
review: never count rounds from context. The count lives on the run per
stage attempt, so a compacted or resumed stage keeps it, and a new attempt
starts at zero.

### Fix each blocking finding test-first, commit

Each fix gets its failing test first, then the fix, then a commit. Ship
presents and pushes what `commits` names, so the field is rewritten with
every sha on the branch, fixes included, before the next review round.

### Follow the domain review

The domain's own review pass, as it words it.

## Domain rules

{{slot:domain}}
