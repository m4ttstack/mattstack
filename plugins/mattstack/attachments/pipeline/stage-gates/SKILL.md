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

- First action: `rt runs stage-start --stage gates`
- Read consumed fields with `rt runs field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `rt runs field set <key> <value> --stage gates`
- Last action on success: `rt runs stage-done --stage gates`;
  on failure: `rt runs stage-fail --stage gates --reason
  "<which gate, what it found>"` before you report it.

Apply every triggered pre-implementation gate NOW, before the implement
stage, and note which gates fired via `rt runs field set
extra.gates <value> --stage gates` (ship-time gates run again inside the
ship stage's domain flow; firing here does not discharge them).

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): there are no domain gates. Say so in one line
and finish. Never invent a gate.
