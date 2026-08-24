---
name: stage-self-review
description: "Pipeline stage: fresh-eyes review of the unit of work before it ships. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  stage: "self-review"
  stage-consumes: "commits"
  stage-produces: "review"
  slots: "domain"
  slot-domain: "optional self-review-domain@1 -- owns the domain's own-work review flow: reviewer context, domain standards, and how findings are dispositioned"
---

# stage: self-review

## Run state

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill). If `RT_RUN_DB`/`RT_PIPELINE_STATE` are unset you
are running standalone -- skip every call in this section silently.

- First action: `"$RT_PIPELINE_STATE" stage-start --stage self-review`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage self-review`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage self-review`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage self-review --reason
  "<what actually failed>"` before you report it.

Read the uow record. Resolve the domain slot; nonzero exit: print `errors`
verbatim and stop. Bound: read the SKILL.md at `resolved.domain.path` and
follow its review flow over the record's `commits`.

Unbound (generic fallback): dispatch one fresh-context subagent to review
the diff (`git diff <branch-point>..HEAD`) against the ticket or task
description: correctness, tests present and honest, scope drift. Fix
blocking findings before finishing (each fix is itself test-first).

Finish by writing `review` (one line: verdict plus findings fixed/waived)
into the record.
