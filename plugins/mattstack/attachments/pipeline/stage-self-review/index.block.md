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

The **re-review cap** is the `review.rereviewRounds` setting. Read it once,
before the first `review-rounds` charge, with
`rt_verb {args: ["settings", "get", "review.rereviewRounds", "--json"]}`
and take its `value`; when that call fails (an older app has no such
setting), the cap is 2. The `review-rounds` limit is the cap + 1, so the
cap's worth of reviews after fix rounds run and the next round of findings
to fix fails the stage.

```mermaid
flowchart TB
%% name: self_review
    self_review_entered([Self-review stage entered])
    run_field_get_commits[/"run_field_get {key: commits}"/]
    domain_rules_inlined{Any domain rule inlined in this stage?}
    dispatch_reviewer
    findings_to_fix{Findings to fix?}
    run_budget_review_rounds[/"run_budget {key: review-rounds, limit: <the re-review cap + 1>, stage: self-review}"/]
    review_rounds_spent{review-rounds spent?}
    fix_findings
    follow_domain_review
    domain_review_gated{How did the domain review's own gate end?}
    git_log_shas_gated[/git log --format=%h <branch-point>..HEAD (after the domain review)/]
    run_field_set_commits_gated[/"run_field_set {key: commits, value: <all shas, the review's fixes included>, stage: self-review}"/]
    git_log_shas[/git log --format=%h <branch-point>..HEAD/]
    run_field_set_commits[/"run_field_set {key: commits, value: <all shas, fixes included>, stage: self-review}"/]
    comment_text_only{Did the fix round keep only comment text?}
    run_field_get_owed[/"run_field_get {key: owed-evidence} (unset reads as an empty list)"/]
    run_field_set_owed[/"run_field_set {key: owed-evidence, value: <the list read, plus one `- [ ] <what to capture> (<finding id>)` line per new owed item; - when both are empty>, stage: self-review}"/]
    run_field_set_review[/"run_field_set {key: review, value: <short Markdown: a first line `Ready to merge: yes | no | with fixes - <the gist in a few words>`; then one `- ` bullet per finding fixed, waived, left open, or owed, starting `Fixed:`, `Waived:`, `Open:` or `Owed:` and naming it, an `Open:` judgment call ending with the reviewer's one-line reason; then the review's Unanswered rules line, when it wrote one>, stage: self-review}"/]
    run_stage_fail[/"run_stage {action: fail, stage: self-review, reason: findings still open after the re-review cap}"/]
    stage_failed(((Stage failed)))
    held_domain_gate(((Held at the domain review's gate)))
    self_review_done(((Self-review done: return to the orchestrator))):::done
    self_review_entered --> run_field_get_commits
    run_field_get_commits --> domain_rules_inlined
    domain_rules_inlined -->|yes| follow_domain_review
    domain_rules_inlined -->|no| dispatch_reviewer
    follow_domain_review --> domain_review_gated
    domain_review_gated -->|answered: it stands, open findings named| git_log_shas_gated
    domain_review_gated -->|no gate ran| findings_to_fix
    domain_review_gated -->|hold| held_domain_gate
    domain_review_gated -->|abandon: it failed the stage| stage_failed
    git_log_shas_gated --> run_field_set_commits_gated
    run_field_set_commits_gated --> run_field_get_owed
    dispatch_reviewer --> findings_to_fix
    findings_to_fix -->|no: none, only judgment calls and owed evidence, or only Minors after a fix round| run_field_get_owed
    findings_to_fix -->|yes| run_budget_review_rounds
    run_budget_review_rounds --> review_rounds_spent
    review_rounds_spent -->|no: not exhausted| fix_findings
    review_rounds_spent -->|yes: exhausted, or a budget error| run_stage_fail
    fix_findings --> git_log_shas
    git_log_shas --> run_field_set_commits
    run_field_set_commits --> comment_text_only
    comment_text_only -->|no: code changed, review again| domain_rules_inlined
    comment_text_only -->|yes: no further review, no charge| run_field_get_owed
    run_field_get_owed --> run_field_set_owed
    run_field_set_owed --> run_field_set_review
    run_field_set_review --> self_review_done
    run_stage_fail --> stage_failed
```
