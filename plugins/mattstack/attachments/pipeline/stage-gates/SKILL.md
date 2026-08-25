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

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill).

- First action: `"$RT_PIPELINE_STATE" stage-start --stage gates`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage gates`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage gates`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage gates --reason
  "<which gate, what it found>"` before you report it.

Apply every triggered pre-implementation gate NOW, before the implement
stage, and note which gates fired via `"$RT_PIPELINE_STATE" field set
extra.gates <value> --stage gates` (ship-time gates run again inside the
ship stage's domain flow; firing here does not discharge them).

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): there are no domain gates. Say so in one line
and finish. Never invent a gate.
