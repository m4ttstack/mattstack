---
name: stage-plan
description: "Pipeline stage: triage the approach and commit to it visibly before any implementation. Reached only through a resolved pipeline; not for direct invocation."
disable-model-invocation: true
type: pipeline-step
slots:
  domain: { contract: plan-domain@1, required: false }
metadata:
  stage: "plan"
  stage-consumes: "ticket"
  stage-produces: "approach evidence-plan"
---

# stage: plan

{{stage.fields}}

## Run state

Contract v2 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `"$RT_PIPELINE_STATE" stage-start --stage plan`
- Read consumed fields with `"$RT_PIPELINE_STATE" field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `"$RT_PIPELINE_STATE" field set <key> <value> --stage plan`
- Last action on success: `"$RT_PIPELINE_STATE" stage-done --stage plan`;
  on failure: `"$RT_PIPELINE_STATE" stage-fail --stage plan --reason
  "<what actually failed>"` before you report it.

Read the ticket (or the task description standing in for one).

## Domain rules

{{slot:domain}}

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
| "I already know this is a superpowers job, no need to say so" | Say so. The block is how the human and the run state verify your triage. |
| "I'll skip the FAILING TEST line, I know what I'll test" | Then writing the line costs nothing. Skipping it is how TDD silently becomes tests-after. |

**REQUIRED SUB-FLOW:** Follow the strategy flow below to pick the tier. The
three tiers listed after it are its strategies of the same names; the other
strategies it defines are not tiers of this stage.

{{include:execution-strategy}}

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
--decided-by stage-plan`.

Plus every additional line the bound domain policy defines (printed
exactly as it specifies), and any tier floor it sets. On direct-tdd the
FAILING TEST line is mandatory: naming the test before touching code is
the point.

Finish by writing `approach` (the tier) and `evidence-plan` (the EVIDENCE
value).
