---
name: work-next-gates
description: "Pipeline stage: apply the domain's mandatory gates for the paths this unit of work touches, before implementation. Reached only through the work-next orchestrator; not for direct invocation."
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

Run state: the orchestrator opens and closes this stage, so never write
`run_stage` `start` or `done` here. Read consumes with `run_field_get`; on
failure write `run_stage {action: fail, stage: "gates", reason}` naming
which gate failed and what it found.

```dot
digraph gates {
    rankdir=TB;

    "Gates stage entered" [shape=ellipse];
    "Domain rules inlined?" [shape=diamond];
    "Say in one line there are no domain gates" [shape=box];
    "STOP: never invent a gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Apply every triggered pre-implementation gate" [shape=box];
    "run_field_set {key: extra.gates, value: <the gates that fired>, stage: gates}" [shape=plaintext];
    "Any gate failed?" [shape=diamond];
    "run_stage {action: fail, stage: gates, reason}" [shape=plaintext];
    "Stage failed" [shape=doublecircle];
    "Gates done: return to the orchestrator" [shape=doublecircle style=filled fillcolor=lightgreen];

    "Gates stage entered" -> "Domain rules inlined?";
    "Domain rules inlined?" -> "Say in one line there are no domain gates" [label="no"];
    "Domain rules inlined?" -> "Apply every triggered pre-implementation gate" [label="yes"];
    "Say in one line there are no domain gates" -> "Gates done: return to the orchestrator";
    "Say in one line there are no domain gates" -> "STOP: never invent a gate" [label="tempted to add one"];
    "STOP: never invent a gate" -> "Gates done: return to the orchestrator";
    "Apply every triggered pre-implementation gate" -> "run_field_set {key: extra.gates, value: <the gates that fired>, stage: gates}";
    "run_field_set {key: extra.gates, value: <the gates that fired>, stage: gates}" -> "Any gate failed?";
    "Any gate failed?" -> "run_stage {action: fail, stage: gates, reason}" [label="yes"];
    "Any gate failed?" -> "Gates done: return to the orchestrator" [label="no"];
    "run_stage {action: fail, stage: gates, reason}" -> "Stage failed";
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
