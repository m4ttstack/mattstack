---
name: stage-ship
description: "Pipeline stage: publish the unit of work for review -- push, open the MR/PR, attach evidence. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  stage: "ship"
  stage-consumes: "commits ticket"
  stage-produces: "mr"
  slots: "domain"
  slot-domain: "optional ship-domain@1 -- owns the domain's shipping flow end to end: pre-flight, rebase, push, MR/PR conventions, evidence attachment, ship-time gates"
---

# stage: ship

## Run state

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill). If `RT_RUN_DB`/`RT_PIPELINE_STATE` are unset you
are running standalone -- skip every call in this section silently.

- First action: `"$RT_PIPELINE_STATE" stage-start --stage ship`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage ship`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage ship`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage ship --reason
  "<what actually failed>"` before you report it.

Read the uow record. Resolve the domain slot; nonzero exit: print `errors`
verbatim and stop. Bound: read the SKILL.md at `resolved.domain.path` and
follow it end to end -- it owns pre-flight, ship-time gates, and evidence
attachment.

Unbound (generic fallback): push the branch (`git push -u origin
<branch>`), then open a PR/MR with the repo's forge CLI (`gh pr create` or
`glab mr create`), title from the ticket or first commit subject, body
linking the ticket and the record's `evidence` entries. Never force-push;
never push a branch whose tests you have not seen pass in this session.

Finish by writing `mr` (the MR/PR URL) into the record.
