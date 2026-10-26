---
node: write_pending_source
---

# Write the pending round's source for gate_open

The `run_field_get` value is `{"gate": <id or null>, "source": {...}}`. A
non-null `gate` is the in-pane gate the earlier pane opened, and a human
may have answered it on another surface after that pane went away:
`gate_reconcile` reads it first, and an `answered` status goes straight to
`gate_record {..., gateId: <that id>}` and the rows, never a second ask.
Otherwise write its `source`, unchanged, to `<dir>/respond-plan.source.json` (`<dir>`
as `Build the open` makes it), then open or hand back exactly as a freshly
built round would. The threads, verdicts and replies are the pending
round's; never re-read threads, re-adjudicate or redraft for it. A
caller that owns the gates gets the verdict table from the stored cards:
one row per thread question, its `label`, `context.verdict.call` and
`context.reply.text`.
