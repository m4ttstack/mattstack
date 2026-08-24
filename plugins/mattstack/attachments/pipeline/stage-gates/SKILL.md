---
name: stage-gates
description: "Pipeline stage: apply the domain's mandatory gates for the paths this unit of work touches, before implementation. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  stage: "gates"
  stage-consumes: "approach worktree"
  stage-produces: "-"
  slots: "domain"
  slot-domain: "optional gates-domain@1 -- names the path-triggered mandatory gates for this domain and how to apply each before implementing and again before shipping"
---

# stage: gates

## Run state

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill). If `RT_RUN_DB`/`RT_PIPELINE_STATE` are unset you
are running standalone -- skip every call in this section silently.

- First action: `"$RT_PIPELINE_STATE" stage-start --stage gates`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage gates`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage gates`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage gates --reason
  "<which gate, what it found>"` before you report it.

Read the uow record. Resolve the domain slot; nonzero exit: print `errors`
verbatim and stop.

Bound: read the SKILL.md at `resolved.domain.path`; it defines which
planned paths trigger which gates. Apply every triggered pre-implementation
gate NOW, before the implement stage, and record which gates fired under
`extra.gates` in the record (ship-time gates run again inside the ship
stage's domain flow; firing here does not discharge them).

Unbound (generic fallback): there are no domain gates. Say so in one line
and finish. Never invent a gate.
