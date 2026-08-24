---
name: stage-plan
description: "Pipeline stage: triage the approach and commit to it visibly before any implementation. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  stage: "plan"
  stage-consumes: "ticket"
  stage-produces: "approach evidence-plan"
  slots: "domain"
  slot-domain: "optional plan-domain@1 -- contributes the domain's policy to triage: always-on constraints, extra printed commitment lines (gates, evidence rules), and any tier floor"
---

# stage: plan

## Run state

Contract v2 (authoritative text: `references/convention.md` in the
parameterized-skills skill). If `RT_RUN_DB`/`RT_PIPELINE_STATE` are unset you
are running standalone -- skip every call in this section silently.

- First action: `"$RT_PIPELINE_STATE" stage-start --stage plan`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage plan`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage plan`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage plan --reason
  "<what actually failed>"` before you report it.

Read the uow record. Read the ticket (or the task description standing in
for one). Resolve the domain slot; nonzero exit: print `errors` verbatim
and stop. Bound: read the SKILL.md at `resolved.domain.path` FIRST -- its
constraints apply to everything after, and it defines extra lines for the
commitment block below.

<HARD-GATE>
Print the triage block below before any implementation action -- before
writing or editing code, before creating a file, before dispatching an
implementer subagent. Not optional, not internal reasoning, not skippable
for "obvious" work.
</HARD-GATE>

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "This is an obvious one-line fix, I'll just do it" | Print the block. An obvious fix is `direct-tdd`, not an exemption. |
| "I'll state the approach after I look at the code" | The gate is BEFORE code, not after. Print it now. |
| "It's basically trivial" | Only docs/config/rename are trivial. Behavior change = direct-tdd. Print it. |
| "I already know this is a superpowers job, no need to say so" | Say so. The block is how the human and the record verify your triage. |
| "I'll skip the FAILING TEST line, I know what I'll test" | Then writing the line costs nothing. Skipping it is how TDD silently becomes tests-after. |

**REQUIRED SUB-FLOW:** Read
`../../../attachments/execution-strategy/SKILL.md` (relative to this
file) to pick the tier. The three tiers below are its strategies of the same names; the
other strategies it defines are not tiers of this stage.

Print verbatim, one tier:

> APPROACH: trivial -- <one-line reason>
> EVIDENCE: <per the domain policy; "none -- no policy bound" otherwise>

> APPROACH: direct-tdd -- <one-line reason>
> FAILING TEST: <the test you will write first, named>
> EVIDENCE: <as above>

> APPROACH: superpowers -- <one-line reason>
> EVIDENCE: <as above>

Record it: `"$RT_PIPELINE_STATE" decision record --contract
execution-strategy@1 --scope run --selection '{"tier":"<chosen tier>"}'
--decided-by stage-plan` (skip silently when running standalone).

Plus every additional line the bound domain policy defines (printed
exactly as it specifies), and any tier floor it sets. On direct-tdd the
FAILING TEST line is mandatory: naming the test before touching code is
the point.

Finish by writing `approach` (the tier) and `evidence-plan` (the EVIDENCE
value) into the record.
