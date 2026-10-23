---
node: gate_plan
kind: gate
props:
  rules:
    merge: add
    default: ""
---

# Gate plan (table below)

Walk gate-protocol's Runs integration with kind `plan`, `runDb` and
`stage: "plan"`; the gate tools record the answers. One sentence above the
form: the printed tier and why.

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `tier` (write-in) | the printed tier, its label ending ` (Recommended)`, then the other two | always |
| `failing_test` | the FAILING TEST line to keep, or their rename as text | direct-tdd |
| the domain's own | as the domain policy words them | the domain declares them |
| `next` | **Proceed** / **Iterate here** / **Go back** / **Hold** | always |
| `to` | one option per earlier stage, split `to-1`, ... over 4 | Go back answered and more than one earlier stage row |

Write `approach` = the tier the gate recorded and `evidence-plan` = the
EVIDENCE value, after the `execution-strategy@1` record: the gate tools
record the gate's answers, not that contract.
Hold passes their words (or `held`) as `reason` and the gate result's
`decidedBy`.

{{props.rules}}
