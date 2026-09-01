---
name: stage-evidence
description: "Pipeline stage: capture the before-state evidence the plan committed to, while the before still exists. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: evidence-domain@1, required: false }
metadata:
  stage: "evidence"
  stage-consumes: "evidence-plan worktree"
  stage-produces: "evidence"
---

# stage: evidence

{{stage.fields}}

## Run state

Contract v2 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `rt runs stage-start --stage evidence`
- Read consumed fields with `rt runs field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `rt runs field set <key> <value> --stage evidence`
- Last action on success: `rt runs stage-done --stage evidence`;
  on failure: `rt runs stage-fail --stage evidence --reason
  "<what actually failed>" --detail-path <path to whatever was captured
  before the failure>` before you report it.

If `evidence-plan` is `none` (or starts with `none`), write `evidence` as
`{"plan": "none"}` and finish -- nothing to capture.

Capture the BEFORE per the plan now -- before implementation changes the
surface. Do not defer the before to ship time: reverting code on a running
dev server to reconstruct it produces stale, false befores. If the ticket
already embeds the broken state, that IS the before -- record its location
instead of recapturing.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): capture what a generic toolchain can -- the
failing test output, a CLI transcript, or a screenshot the user provides --
and store it under `~/.mattstack/work/<work-id>/evidence/`.

Finish by writing `evidence` (an object of labeled paths/URLs, at minimum
the before). The ship stage attaches; it never captures.
