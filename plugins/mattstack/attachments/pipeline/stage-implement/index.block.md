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

```mermaid
flowchart TB
%% name: implement
    implement_entered([Implement stage entered])
    run_field_get_approach[/"run_field_get {key: approach}"/]
    run_field_get_branch[/"run_field_get {key: branch}"/]
    run_field_get_worktree[/"run_field_get {key: worktree}"/]
    approach_tier{approach?}
    make_trivial_change
    test_while_trivial{Found yourself writing a test?}
    red_green_refactor
    superpowers_chain
    commit_incrementally[Commit incrementally on branch, inside worktree]
    next_move{Next move once committed?}
    stop_implement_push[STOP: implement never pushes; ship owns the push]:::stop
    git_log_shas[/git log --format=%h <branch-point>..HEAD/]
    run_field_set_commits[/"run_field_set {key: commits, value: <shas>, stage: implement}"/]
    run_stage_fail[/"run_stage {action: fail, stage: implement, reason}"/]
    stage_failed(((Stage failed)))
    tell_triage_wrong(((Tell the orchestrator the triage was wrong: Go back to plan)))
    implement_done(((Implement done: return to the orchestrator))):::done
    implement_entered --> run_field_get_approach
    run_field_get_approach --> run_field_get_branch
    run_field_get_branch --> run_field_get_worktree
    run_field_get_worktree --> approach_tier
    approach_tier -->|trivial| make_trivial_change
    approach_tier -->|direct-tdd| red_green_refactor
    approach_tier -->|superpowers| superpowers_chain
    make_trivial_change --> test_while_trivial
    test_while_trivial -->|yes| tell_triage_wrong
    test_while_trivial -->|no| commit_incrementally
    red_green_refactor --> commit_incrementally
    red_green_refactor -->|a failure the approach cannot get past| run_stage_fail
    superpowers_chain --> commit_incrementally
    superpowers_chain -->|a failure the approach cannot get past| run_stage_fail
    commit_incrementally --> next_move
    next_move -->|record the commits| git_log_shas
    next_move -->|tempted to push| stop_implement_push
    stop_implement_push --> git_log_shas
    git_log_shas --> run_field_set_commits
    run_field_set_commits --> implement_done
    run_stage_fail --> stage_failed
```
