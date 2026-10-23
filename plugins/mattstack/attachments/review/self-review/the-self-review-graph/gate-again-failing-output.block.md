---
node: gate_again_failing_output
kind: gate
---

# Gate self-review again: quote the failing output

A new gate on its own scope, so the fix gate's decision stays: run
gate-protocol's Runs integration with `gate_ask {questions, kind:
self-review-retry:<finding id>, context, runDb, stage}`. The kind is the
scope, so the answers map `{finding, next}` records there. `context`
quotes the failing test output and names the finding. Questions, each its
own:

- `finding` (write-in): **Try this finding again** (`retry:<finding id>`)
  / **Leave it open and move on** (`leave:<finding id>`)
- `next`: **Proceed** (`proceed`, recommended) / **Hold** (`hold`) /
  **Abandon** (`abandon`)

`next: hold` or `abandon` wins whatever `finding` says, a write-in riding
as its note; otherwise `finding` decides, and a write-in goes through Act
on a write-in. `retry:<finding id>` starts round 2: later failures charge
`fix:<finding id>:2`. On a resume, a `retry:<finding id>` decision at this
scope means round 2.
