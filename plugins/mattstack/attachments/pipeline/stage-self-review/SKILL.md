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

Contract v2 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `"$RT_PIPELINE_STATE" stage-start --stage self-review`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage self-review`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage self-review`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage self-review --reason
  "<what actually failed>"` before you report it.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): dispatch one fresh-context subagent to review
the diff (`git diff <branch-point>..HEAD`) against the ticket or task
description: correctness, tests present and honest, scope drift. Fix
blocking findings before finishing (each fix is itself test-first).

Finish by writing `review` (one line: verdict plus findings fixed/waived).
