---
name: stage-plan
description: "Pipeline stage: triage the approach and commit to it visibly before any implementation. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "plan"
  stage-consumes: "ticket"
  stage-produces: "approach evidence-plan"
replaced-slots: [domain]
---

# stage: plan

{{stage.fields}}

The orchestrator owns this stage's rows: read consumes with
`run_field_get`, write produces with `run_field_set {stage: "plan"}`, and
end a failure with `run_stage {action: fail, stage: "plan", reason}`.

```mermaid
flowchart TB
%% name: plan
    plan_entered([Plan stage entered])
    run_field_get_ticket[/"run_field_get {key: ticket}"/]
    read_ticket
    next_move_after_ticket{Next move after reading the ticket?}
    stop_code_before_triage[STOP: no code, no file, no implementer dispatch before the printed block]:::stop
    pick_tier
    print_triage_block
    gate_plan
    plan_answer{plan answer?}
    run_decision_strategy[/"run_decision {contract: execution-strategy@1, scope: run, selection: {tier}, decidedBy: stage-plan}"/]
    run_field_set_approach[/"run_field_set {key: approach, value: <the recorded tier>, stage: plan}"/]
    run_field_set_evidence_plan[/"run_field_set {key: evidence-plan, value: <the EVIDENCE value>, stage: plan}"/]
    hand_back_go_back(((Hand the Go back answer to the orchestrator)))
    run_hold[/"run_hold {runDb, stage: plan, reason, decidedBy}"/]
    held_end_turn(((Held: end the turn naming run and stage)))
    plan_done(((Plan done: return to the orchestrator))):::done
    plan_entered --> run_field_get_ticket
    run_field_get_ticket --> read_ticket
    read_ticket --> next_move_after_ticket
    next_move_after_ticket -->|triage: pick the tier| pick_tier
    next_move_after_ticket -->|tempted to start on the code| stop_code_before_triage
    stop_code_before_triage --> pick_tier
    pick_tier --> print_triage_block
    print_triage_block --> gate_plan
    gate_plan --> plan_answer
    plan_answer -->|proceed| run_decision_strategy
    plan_answer -->|iterate: re-read with their note| read_ticket
    plan_answer -->|go back| hand_back_go_back
    plan_answer -->|hold| run_hold
    run_hold --> held_end_turn
    run_decision_strategy --> run_field_set_approach
    run_field_set_approach --> run_field_set_evidence_plan
    run_field_set_evidence_plan --> plan_done
```
