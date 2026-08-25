---
name: stage-ship
description: "Pipeline stage: publish the unit of work for review -- push, open the MR/PR, attach evidence. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: ship-domain@1, required: false }
metadata:
  stage: "ship"
  stage-consumes: "commits ticket"
  stage-produces: "mr"
---

# stage: ship

{{stage.fields}}

## Run state

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill).

- First action: `"$RT_PIPELINE_STATE" stage-start --stage ship`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage ship`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage ship`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage ship --reason
  "<what actually failed>"` before you report it.

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): push the branch (`git push -u origin
<branch>`), then open a PR/MR with the repo's forge CLI (`gh pr create` or
`glab mr create`), title from the ticket or first commit subject, body
linking the ticket and the `evidence` field's entries. Never force-push;
never push a branch whose tests you have not seen pass in this session.

Finish by writing `mr` (the MR/PR URL).
