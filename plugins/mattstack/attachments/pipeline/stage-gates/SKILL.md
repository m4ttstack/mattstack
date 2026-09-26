---
name: stage-gates
description: "Pipeline stage: apply the domain's mandatory gates for the paths this unit of work touches, before implementation. Reached only through a resolved pipeline; not for direct invocation."
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

## Run state

Contracts v2 and v3 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `run_stage` with `action: "start"`, `stage: "gates"` and the run's `runDb`.
- Read consumed fields with `run_field_get` before deriving or asking for them.
- Write each declared produce the moment it exists with `run_field_set` (`key`, `value`, `stage: "gates"`).
- Last action on success: `run_stage` with `action: "done"`; on failure `run_stage` with `action: "fail"` and a `reason` naming which gate failed and what it found, before you report it.

Apply every triggered pre-implementation gate NOW, before the implement
stage, and note which gates fired with `run_field_set`
(`key: "extra.gates"`, `value` = the gates that fired, `stage: "gates"`).
Ship-time gates run again inside the ship stage's domain flow; firing
here does not discharge them.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): there are no domain gates. Say so in one line
and finish. Never invent a gate.
