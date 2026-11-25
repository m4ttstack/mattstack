---
node: gate_rereview_spent
kind: gate
label: Re-review cap
---

# Gate self-review: the re-review cap is reached

Run gate-protocol's Runs integration with `gate_ask {questions, kind:
self-review-rereview:<n>, context, runDb, stage, needsOperator}`, `<n>`
counting this gate's openings in this run from 1. `context` names the fix
round no re-review has covered, its findings and what each fix changed;
`needsOperator` says the re-review cap is reached. One question:

- `rereview` (write-in): **Re-review this fix round (Recommended)**
  (`rereview`) / **Hand back** (`handback`)

A hand back's reason is their words, else `handed back at the re-review
cap`. On a resume, a `rereview` answer is reused only when no re-review has
run since it. Closing with that round unreviewed is not an option. Each `rereview` answer
buys one re-review; another changed round opens this gate again.
