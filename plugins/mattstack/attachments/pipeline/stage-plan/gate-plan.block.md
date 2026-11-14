---
node: gate_plan
kind: gate
label: Plan gate
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
| `tier` (write-in) | the printed tier, its label ending ` (Recommended)`, then the other two; a write-in names one of the three, and any other is iterated | always |
| the domain's own | as the domain policy words them | the domain declares them |

Write `approach` = the tier the gate recorded, `evidence-plan` = the
EVIDENCE value and `failing-test` = the FAILING TEST line (`none` on any
other tier), after the `execution-strategy@1` record: the gate tools
record the gate's answers, not that contract.
`hold` passes their words (or `held`) as `reason` and the gate result's
`decidedBy`.

{{props.rules}}
