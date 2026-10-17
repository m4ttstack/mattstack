---
name: stage-gates
description: "Pipeline stage: apply the domain's mandatory gates for the paths this unit of work touches, before implementation. Reached only through the work orchestrator; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: gates-domain@1, required: false }
metadata:
  stage: "gates"
  stage-consumes: "approach worktree"
  stage-produces: "-"
---

# stage: gates

{{stage.fields}}

The orchestrator owns this stage's rows: read consumes with
`run_field_get`, write fields with `run_field_set {stage: "gates"}`, and end
a failure with `run_stage {action: fail, stage: "gates", reason}` naming
which gate failed and what it found.

```dot
digraph gates {
    rankdir=TB;

    gates_entered [label="Gates stage entered" shape=ellipse];
    domain_rules_inlined [label="Domain rules inlined?" shape=diamond];
    say_no_gates [label="Say in one line there are no domain gates" shape=box];
    stop_invented_gate [label="STOP: never invent a gate" shape=octagon style=filled fillcolor=red fontcolor=white];
    apply_triggered_gates [label="Apply every triggered pre-implementation gate" shape=box];
    run_field_set_gates [label="run_field_set {key: extra.gates, value: <the gates that fired>, stage: gates}" shape=plaintext];
    any_gate_failed [label="Any gate failed?" shape=diamond];
    run_stage_fail [label="run_stage {action: fail, stage: gates, reason}" shape=plaintext];
    stage_failed [label="Stage failed" shape=doublecircle];
    gates_done [label="Gates done: return to the orchestrator" shape=doublecircle style=filled fillcolor=lightgreen];

    gates_entered -> domain_rules_inlined;
    domain_rules_inlined -> say_no_gates [label="no"];
    domain_rules_inlined -> apply_triggered_gates [label="yes"];
    say_no_gates -> gates_done;
    domain_rules_inlined -> stop_invented_gate [label="tempted to invent a gate when none is inlined"];
    stop_invented_gate -> say_no_gates;
    apply_triggered_gates -> run_field_set_gates;
    run_field_set_gates -> any_gate_failed;
    any_gate_failed -> run_stage_fail [label="yes"];
    any_gate_failed -> gates_done [label="no"];
    run_stage_fail -> stage_failed;
}
```

### Apply every triggered pre-implementation gate

Each gate the domain rules below trigger for the paths this work touches,
now, before implement. Ship-time gates run again inside the ship stage's
domain flow: firing here does not discharge them.

## Domain rules

The domain rules below supply the gates and the paths that trigger them.
Where a domain step names a move the graph above marks STOP (inventing a
gate), the STOP node wins.

{{slot:domain}}
