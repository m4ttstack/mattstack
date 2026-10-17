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

The orchestrator owns this stage's rows: read consumes with
`run_field_get`, write produces with `run_field_set {stage: "implement"}`,
and end a failure with `run_stage {action: fail, stage: "implement",
reason}`.

```dot
digraph implement {
    rankdir=TB;

    implement_entered [label="Implement stage entered" shape=ellipse];
    run_field_get_approach [label="run_field_get {key: approach}" shape=plaintext];
    run_field_get_branch [label="run_field_get {key: branch}" shape=plaintext];
    run_field_get_worktree [label="run_field_get {key: worktree}" shape=plaintext];
    approach_tier [label="approach?" shape=diamond];
    make_trivial_change [label="Make the trivial change" shape=box];
    test_while_trivial [label="Found yourself writing a test?" shape=diamond];
    red_green_refactor [label="Run RED, GREEN, REFACTOR from the named failing test" shape=box];
    superpowers_chain [label="Run the superpowers chain" shape=box];
    commit_incrementally [label="Commit incrementally on branch, inside worktree" shape=box];
    next_move [label="Next move once committed?" shape=diamond];
    stop_implement_push [label="STOP: implement never pushes; ship owns the push" shape=octagon style=filled fillcolor=red fontcolor=white];
    git_log_shas [label="git log --format=%h <branch-point>..HEAD" shape=plaintext];
    run_field_set_commits [label="run_field_set {key: commits, value: <shas>, stage: implement}" shape=plaintext];
    run_stage_fail [label="run_stage {action: fail, stage: implement, reason}" shape=plaintext];
    stage_failed [label="Stage failed" shape=doublecircle];
    tell_triage_wrong [label="Tell the orchestrator the triage was wrong: Go back to plan" shape=doublecircle];
    implement_done [label="Implement done: return to the orchestrator" shape=doublecircle style=filled fillcolor=lightgreen];

    implement_entered -> run_field_get_approach;
    run_field_get_approach -> run_field_get_branch;
    run_field_get_branch -> run_field_get_worktree;
    run_field_get_worktree -> approach_tier;
    approach_tier -> make_trivial_change [label="trivial"];
    approach_tier -> red_green_refactor [label="direct-tdd"];
    approach_tier -> superpowers_chain [label="superpowers"];
    make_trivial_change -> test_while_trivial;
    test_while_trivial -> tell_triage_wrong [label="yes"];
    test_while_trivial -> commit_incrementally [label="no"];
    red_green_refactor -> commit_incrementally;
    red_green_refactor -> run_stage_fail [label="a failure the approach cannot get past"];
    superpowers_chain -> commit_incrementally;
    superpowers_chain -> run_stage_fail [label="a failure the approach cannot get past"];
    commit_incrementally -> next_move;
    next_move -> git_log_shas [label="record the commits"];
    next_move -> stop_implement_push [label="tempted to push"];
    stop_implement_push -> git_log_shas;
    git_log_shas -> run_field_set_commits;
    run_field_set_commits -> implement_done;
    run_stage_fail -> stage_failed;
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
- **Go back to plan** is a Redirect, not a failure: end the stage handing
  back `{to: plan, note: <the triage mismatch: what made the trivial
  change need a test>, decidedBy: pane}`. Write nothing else: the
  orchestrator applies it with `run_resolve`.
