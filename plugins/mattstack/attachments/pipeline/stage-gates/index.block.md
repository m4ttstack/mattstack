---
name: stage-gates
description: "Pipeline stage: apply the domain's mandatory gates for the paths this unit of work touches, before implementation. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "gates"
  stage-consumes: "approach worktree"
  stage-produces: "-"
replaced-slots: [domain]
---

# stage: gates

{{stage.fields}}

The orchestrator owns this stage's rows: read consumes with
`run_field_get`, write fields with `run_field_set {stage: "gates"}`, and end
a failure with `run_stage {action: fail, stage: "gates", reason}` naming
which gate failed and what it found.

```mermaid
flowchart TB
%% name: gates
    gates_entered([Gates stage entered])
    domain_rules_inlined{Domain rules inlined?}
    say_no_gates[Say in one line there are no domain gates]
    stop_invented_gate[STOP: never invent a gate]:::stop
    apply_triggered_gates
    run_field_set_gates[/"run_field_set {key: extra.gates, value: <the gates that fired>, stage: gates}"/]
    any_gate_failed{Any gate failed?}
    run_stage_fail[/"run_stage {action: fail, stage: gates, reason}"/]
    stage_failed(((Stage failed)))
    gates_done(((Gates done: return to the orchestrator))):::done
    gates_entered --> domain_rules_inlined
    domain_rules_inlined -->|no| say_no_gates
    domain_rules_inlined -->|yes| apply_triggered_gates
    say_no_gates --> gates_done
    domain_rules_inlined -->|tempted to invent a gate when none is inlined| stop_invented_gate
    stop_invented_gate --> say_no_gates
    apply_triggered_gates --> run_field_set_gates
    run_field_set_gates --> any_gate_failed
    any_gate_failed -->|yes| run_stage_fail
    any_gate_failed -->|no| gates_done
    run_stage_fail --> stage_failed
```
