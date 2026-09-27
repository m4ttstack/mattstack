---
name: work-next-self-review
description: "Pipeline stage: fresh-eyes review of the unit of work before it ships. Reached only through the work-next orchestrator; not for direct invocation."
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

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read consumes with `run_field_get`,
write `review` with `run_field_set` (`stage: "self-review"`), and on
failure write `run_stage {action: fail, stage: "self-review", reason}`
naming what failed.

```dot
digraph self_review {
    rankdir=TB;

    "Self-review stage entered" [shape=ellipse];
    "run_field_get {key: commits}" [shape=plaintext];
    "Domain rules inlined?" [shape=diamond];
    "Follow the domain review" [shape=box];
    "Dispatch one fresh-context reviewer over the diff" [shape=box];
    "Blocking findings?" [shape=diamond];
    "Review rounds = 3?" [shape=diamond];
    "Fix each blocking finding test-first, commit" [shape=box];
    "git log --format=%h <branch-point>..HEAD" [shape=plaintext];
    "run_field_set {key: commits, value: <all shas, fixes included>, stage: self-review}" [shape=plaintext];
    "run_field_set {key: review, value: <verdict; findings fixed or waived>, stage: self-review}" [shape=plaintext];
    "run_stage {action: fail, stage: self-review, reason: blocking findings after 3 rounds}" [shape=plaintext];
    "Stage failed" [shape=doublecircle];
    "Self-review done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Self-review stage entered" -> "run_field_get {key: commits}";
    "run_field_get {key: commits}" -> "Domain rules inlined?";
    "Domain rules inlined?" -> "Follow the domain review" [label="yes"];
    "Domain rules inlined?" -> "Dispatch one fresh-context reviewer over the diff" [label="no"];
    "Follow the domain review" -> "Blocking findings?";
    "Dispatch one fresh-context reviewer over the diff" -> "Blocking findings?";
    "Blocking findings?" -> "run_field_set {key: review, value: <verdict; findings fixed or waived>, stage: self-review}" [label="no"];
    "Blocking findings?" -> "Review rounds = 3?" [label="yes"];
    "Review rounds = 3?" -> "Fix each blocking finding test-first, commit" [label="no"];
    "Review rounds = 3?" -> "run_stage {action: fail, stage: self-review, reason: blocking findings after 3 rounds}" [label="yes"];
    "Fix each blocking finding test-first, commit" -> "git log --format=%h <branch-point>..HEAD";
    "git log --format=%h <branch-point>..HEAD" -> "run_field_set {key: commits, value: <all shas, fixes included>, stage: self-review}";
    "run_field_set {key: commits, value: <all shas, fixes included>, stage: self-review}" -> "Domain rules inlined?" [label="review again"];
    "run_field_set {key: review, value: <verdict; findings fixed or waived>, stage: self-review}" -> "Self-review done: return to the orchestrator";
    "run_stage {action: fail, stage: self-review, reason: blocking findings after 3 rounds}" -> "Stage failed";
}
```

### Dispatch one fresh-context reviewer over the diff

The unbound review: one subagent reads `git diff <branch-point>..HEAD`
against the ticket or task description for correctness, tests present and
honest, and scope drift.

### Fix each blocking finding test-first, commit

Each fix gets its failing test first, then the fix, then a commit. Ship
presents and pushes what `commits` names, so the field is rewritten with
every sha on the branch, fixes included, before the next review round.

### Follow the domain review

The domain's own review pass, as it words it.

## Domain rules

{{slot:domain}}
