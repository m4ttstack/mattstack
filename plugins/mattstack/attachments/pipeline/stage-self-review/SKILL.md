---
name: stage-self-review
description: "Pipeline stage: fresh-eyes review of the unit of work before it ships. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: self-review-domain@1, required: false }
metadata:
  stage: "self-review"
  stage-consumes: "commits"
  stage-produces: "review"
---

# stage: self-review

{{stage.fields}}

## Run state

Contracts v2 and v3 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `run_stage` with `action: "start"`, `stage: "self-review"` and the run's `runDb`.
- Read consumed fields with `run_field_get` before deriving or asking for them.
- Write each declared produce the moment it exists with `run_field_set` (`key`, `value`, `stage: "self-review"`).
- Last action on success: `run_stage` with `action: "done"`; on failure `run_stage` with `action: "fail"` and a `reason` naming what actually failed, before you report it.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): dispatch one fresh-context subagent to review
the diff (`git diff <branch-point>..HEAD`) against the ticket or task
description: correctness, tests present and honest, scope drift. Fix
blocking findings before finishing (each fix is itself test-first).

Finish by writing `review` (one line: verdict plus findings fixed/waived).
