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

Contracts v2 and v3 (authoritative text: the parameterized-skills skill's convention reference).

- First action: `rt runs stage-start --stage plan`
- Read consumed fields with `rt runs field get <key>` before
  deriving or asking for them.
- Write each declared produce the moment it exists:
  `rt runs field set <key> <value> --stage plan`
- Last action on success: `rt runs stage-done --stage plan`;
  on failure: `rt runs stage-fail --stage plan --reason
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
| "The tier is obvious, I'll record it and move on" | Printing is the proposal. Recording without the form takes the human's decision for them. |

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

Record nothing yet: the tier is recorded through the plan gate below, once
the whole proposal (this block plus the domain policy's lines) is printed.

Plus every additional line the bound domain policy defines (printed
exactly as it specifies), and any tier floor it sets. On direct-tdd the
FAILING TEST line is mandatory: naming the test before touching code is
the point.

Then the plan gate, scope `plan`. The printed block is the proposal; the
human's answer is the decision:

- `rt runs field set gate plan --stage plan`
- One sentence naming the printed tier and why.
- The form: the tier, printed one first and labelled `(Recommended)`, the
  other two as alternatives; on direct-tdd a second question confirming
  the FAILING TEST line (keep / rename it: their text); every question the
  bound domain policy declares for this gate, as it words them; then
  **Iterate here**, **Go back to `<stage>`** (one option per earlier stage
  row in `snapshot`), and **Hold**.
- `rt runs decision record --contract gate@1 --scope plan --selection '{"tier":"<picked>","failing_test":"<as confirmed or null>","domain":{<the domain questions' answers>},"next":"proceed|iterate|redirect|hold","to":"<stage or null>","note":"<their words or null>"}' --decided-by stage-plan`
- `rt runs decision record --contract execution-strategy@1 --scope run --selection '{"tier":"<picked tier>"}' --decided-by stage-plan`
- Iterate: re-read the ticket with their note and print a new triage
  block, then gate again. Hold: record `hold:plan:<attempt>` and `rt runs
  field set hold "<their words>" --stage plan`, then end the turn. Go back:
  hand control back to the orchestrator with one sentence naming the
  answer; it runs `## Redirect`.

Finish by writing `approach` (the tier the gate recorded) and
`evidence-plan` (the EVIDENCE value).

## Wrap-up form contract

{{include:wrap-up-form}}
