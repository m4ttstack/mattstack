---
node: gate_plan_carry
kind: gate
label: Respond plan
---

# Gate respond-plan: carry the opened gate through gate-protocol

**Otherwise** (a direct terminal run) the verb runs the gate itself: enter
gate-protocol at `Trigger: a site opened its gate with gate_open` with the
result and walk on from `paneAction?`; a gate is never asked or answered
from the shell.

When the result says `contextDropped: true`, first write one line,
`gate-1-context: dropped`, into the saved verdict report (when there is
one), before waiting: a resumed pane has no other way to
know those pane cards never showed their drafts. The record then passes
`contextDropped: true`.

respond-plan is answered on the board only: its `paneAction` is always
`wait`, so this pane never presents a form for it. Wait as gate-protocol
draws it (the doorbell, then reconcile); the board's answer routes as
`respond-plan next answer?` draws.

A `next` of `iterate` or `hold` records nothing: `iterate` redrafts with
their note, `hold` holds. Only a hand-back or a future surface can send
one: the daemon refuses an answer key the gate did not ask.

Neither `gate_answer` nor `gate_reconcile` records this review gate:
`gate_record {..., gateId: <id>}` does. Never fold threads into one
multi-select: one question per thread stays under the form cap.
`fix:<threadId>` implies that thread's reply, `skip:<threadId>` means
neither.
