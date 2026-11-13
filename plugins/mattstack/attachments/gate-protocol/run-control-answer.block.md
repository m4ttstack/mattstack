---
node: run_control_answer
label: Run control
---

# A run control (next hold or go-back)?

The kit form's Pause run answers `{next: hold}`, and its Go back to stage
answers `{next: go-back, to: <stage>}`. Read `next` off the result. At
every run gate, the answer goes to `run_resolve` with the result's
`decidedBy` and the answer's note, when it carries one:

| `next` | `run_resolve` |
|---|---|
| `hold` | `{next: hold}` |
| `go-back` | `{next: redirect, to: <answers.to>}` |

The site's own questions are not acted on, and the gate is not decided:
`gate_reconcile` recorded no gate decision, so none is recorded, and the
site's own hold and go-back edges are not taken. A refused `run_resolve`
holds the run with `run_hold`, the refusal as its reason.
