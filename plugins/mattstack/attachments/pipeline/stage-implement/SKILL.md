---
name: stage-implement
description: "Pipeline stage: build the change under the approach the plan stage committed to, test-first. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "implement"
  stage-consumes: "approach branch worktree"
  stage-produces: "commits"
---

# stage: implement

{{stage.fields}}

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read consumes with `run_field_get`,
write `commits` with `run_field_set` (`stage: "implement"`), and on
failure write `run_stage {action: fail, stage: "implement", reason}`
naming what failed.

```dot
digraph implement {
    rankdir=TB;

    "Implement stage entered" [shape=ellipse];
    "run_field_get {key: approach}; {key: branch}; {key: worktree}" [shape=plaintext];
    "approach?" [shape=diamond];
    "Make the trivial change" [shape=box];
    "Found yourself writing a test?" [shape=diamond];
    "Run RED, GREEN, REFACTOR from the named failing test" [shape=box];
    "Run the superpowers chain" [shape=box];
    "Commit incrementally on branch, inside worktree" [shape=box];
    "Next move once committed?" [shape=diamond];
    "STOP: implement never pushes; ship owns the push" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "git log --format=%h <branch-point>..HEAD" [shape=plaintext];
    "run_field_set {key: commits, value: <shas>, stage: implement}" [shape=plaintext];
    "run_stage {action: fail, stage: implement, reason}" [shape=plaintext];
    "Stage failed" [shape=doublecircle];
    "Tell the orchestrator the triage was wrong: Go back to plan" [shape=doublecircle];
    "Implement done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Implement stage entered" -> "run_field_get {key: approach}; {key: branch}; {key: worktree}";
    "run_field_get {key: approach}; {key: branch}; {key: worktree}" -> "approach?";
    "approach?" -> "Make the trivial change" [label="trivial"];
    "approach?" -> "Run RED, GREEN, REFACTOR from the named failing test" [label="direct-tdd"];
    "approach?" -> "Run the superpowers chain" [label="superpowers"];
    "Make the trivial change" -> "Found yourself writing a test?";
    "Found yourself writing a test?" -> "Tell the orchestrator the triage was wrong: Go back to plan" [label="yes"];
    "Found yourself writing a test?" -> "Commit incrementally on branch, inside worktree" [label="no"];
    "Run RED, GREEN, REFACTOR from the named failing test" -> "Commit incrementally on branch, inside worktree";
    "Run RED, GREEN, REFACTOR from the named failing test" -> "run_stage {action: fail, stage: implement, reason}" [label="a failure the approach cannot get past"];
    "Run the superpowers chain" -> "Commit incrementally on branch, inside worktree";
    "Run the superpowers chain" -> "run_stage {action: fail, stage: implement, reason}" [label="a failure the approach cannot get past"];
    "Commit incrementally on branch, inside worktree" -> "Next move once committed?";
    "Next move once committed?" -> "git log --format=%h <branch-point>..HEAD" [label="record the commits"];
    "Next move once committed?" -> "STOP: implement never pushes; ship owns the push" [label="tempted to push"];
    "STOP: implement never pushes; ship owns the push" -> "git log --format=%h <branch-point>..HEAD";
    "git log --format=%h <branch-point>..HEAD" -> "run_field_set {key: commits, value: <shas>, stage: implement}";
    "run_field_set {key: commits, value: <shas>, stage: implement}" -> "Implement done: return to the orchestrator";
    "run_stage {action: fail, stage: implement, reason}" -> "Stage failed";
}
```

### Make the trivial change

No test, because there is no runtime behavior: docs, config, a rename.

### Run RED, GREEN, REFACTOR from the named failing test

**REQUIRED SUB-SKILL:** superpowers:test-driven-development, inline,
starting from the FAILING TEST the plan stage named. No spec doc, no
subagents.

### Run the superpowers chain

superpowers:brainstorming, then the spec, then superpowers:writing-plans,
then subagent execution. TDD still holds inside every task. When
dispatching sub-agents, apply the orchestrator's resolved tiering skill if
it announced one.

## What the graph cannot show

- **A failure the approach cannot get past** (a test that cannot be made
  to run, a dependency that will not resolve, a question the plan left
  open) ends the stage with `run_stage {action: fail, stage: "implement",
  reason}` naming it. Switching approach inside this stage is not a way
  past it.
- **Go back to plan** is a Redirect, not a failure: hand it to the
  orchestrator with `to: plan`, `decidedBy: "pane"`, and the triage
  mismatch (what made the trivial change need a test) as the reason.
