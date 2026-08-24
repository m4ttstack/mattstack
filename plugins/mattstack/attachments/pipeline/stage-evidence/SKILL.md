---
name: stage-evidence
description: "Pipeline stage: capture the before-state evidence the plan committed to, while the before still exists. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  stage: "evidence"
  stage-consumes: "evidence-plan worktree"
  stage-produces: "evidence"
  slots: "domain"
  slot-domain: "optional evidence-domain@1 -- owns the domain's evidence capture mechanics: how to capture, what data source to use, and where captures live"
---

# stage: evidence

## Run state

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill). If `RT_RUN_DB`/`RT_PIPELINE_STATE` are unset you
are running standalone -- skip every call in this section silently.

- First action: `"$RT_PIPELINE_STATE" stage-start --stage evidence`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage evidence`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage evidence`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage evidence --reason
  "<what actually failed>" --detail-path <path to whatever was captured
  before the failure>` before you report it.

Read the uow record. If `evidence-plan` is `none` (or starts with `none`),
write `evidence` as `{"plan": "none"}` and finish -- nothing to capture.

Otherwise resolve the domain slot; nonzero exit: print `errors` verbatim
and stop. Bound: read the SKILL.md at `resolved.domain.path` and capture
the BEFORE per the plan now -- before implementation changes the surface.
Do not defer the before to ship time: reverting code on a running dev
server to reconstruct it produces stale, false befores. If the ticket
already embeds the broken state, that IS the before -- record its location
instead of recapturing.

Unbound (generic fallback): capture what a generic toolchain can -- the
failing test output, a CLI transcript, or a screenshot the user provides --
and store it under `~/.mattstack/work/<work-id>/evidence/`.

Finish by writing `evidence` (an object of labeled paths/URLs, at minimum
the before) into the record. The ship stage attaches; it never captures.
