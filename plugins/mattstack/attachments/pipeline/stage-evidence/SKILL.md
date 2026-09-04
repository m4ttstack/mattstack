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

Contracts v2 and v3 (authoritative text: the parameterized-skills skill's convention reference).

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

## Gate `evidence`

Before any capture, when the domain rules below declare intake questions,
or the data source is anything other than the local default:

- `rt runs field set gate evidence --stage evidence`
- One sentence: what the plan asks for and what is unknown.
- Run gate-protocol's Runs integration with kind `evidence` and these
  questions: the domain's intake questions as it words them; the data
  source when it is not local (**Proceed with `<source>`** / **Switch to
  local**); then **Iterate here** and **Hold**.
- `rt runs decision record --contract gate@1 --scope evidence --selection '{"intake":{<answers>},"source":"<as confirmed>"}' --decided-by <the answer's by>`

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

Unbound (generic fallback): capture what a generic toolchain can -- the
failing test output, a CLI transcript, or a screenshot the user provides --
and store it under `~/.mattstack/work/<work-id>/evidence/`.

## Gate `evidence-attach`

Before the MR is modified, when the domain rules attach here and an MR
already exists for the branch (the ship stage normally attaches):

- `rt runs field set gate evidence-attach --stage evidence`
- One sentence: what was captured and where it sits.
- Run gate-protocol's Runs integration with kind `evidence-attach` and
  these questions: the proposed annotations as a multi-select, all
  pre-selected; **Hand back the markdown** (recommended; the ship stage
  attaches) / **Attach to the MR now**; **Iterate here**; **Hold**.
- `rt runs decision record --contract gate@1 --scope evidence-attach --selection '{"annotations":[...],"attach":"now|handback"}' --decided-by <the answer's by>`

Hold at either gate: record `hold:evidence:<attempt>`, `rt runs field set
hold "<their words>" --stage evidence`, end the turn.

**These thoughts mean you are skipping the gate -- STOP:**

| Thought | Reality |
|---------|---------|
| "I don't have concrete case IDs or view names to offer, so I'll add a note after the form explaining that gap" | An open-ended intake question needs no invented options; render it as free text inside the form itself and stop. Explaining the gap outside the form is prose the gate forbids. |

Finish by writing `evidence` (an object of labeled paths/URLs, at minimum
the before). This stage captures the BEFORE. The ship stage attaches the
pair, and where the bound ship domain captures an AFTER it does so there.

## Gate protocol

{{include:gate-protocol}}

## Wrap-up form contract

{{include:wrap-up-form}}
