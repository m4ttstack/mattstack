---
name: stage-implement
description: "Pipeline stage: build the change under the approach the plan stage committed to, test-first. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
metadata:
  stage: "implement"
  stage-consumes: "approach branch worktree"
  stage-produces: "commits"
---

# stage: implement

{{stage.fields}}

## Run state

Contract v2 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `"$RT_PIPELINE_STATE" stage-start --stage implement`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage implement`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage implement`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage implement --reason
  "<what actually failed>"` before you report it.

Honor `approach` exactly:

- **trivial**: make the change; no test because there is no runtime
  behavior. If you find yourself testing anyway, the triage was wrong --
  stop and tell the orchestrator to re-run the plan stage.
- **direct-tdd**: invoke superpowers:test-driven-development and run
  RED -> GREEN -> REFACTOR inline, starting from the FAILING TEST the plan
  stage named. No spec doc, no subagents.
- **superpowers**: run the chain -- superpowers:brainstorming ->
  spec -> superpowers:writing-plans -> subagent execution. TDD still
  holds inside every task. When dispatching sub-agents, apply the
  orchestrator's resolved tiering skill if it announced one.

Work only inside `worktree`, commit incrementally on `branch`, never push
from this stage. Finish by writing `commits` (the new commit shas,
`git log --format=%h` since the branch point).
