---
node: present_open_gates
kind: gate
---

# Present the open gates

Present up to 4 open gates in one AskUserQuestion call. Options are the
gate's `label` (else text) and `description`, the recommendation first,
never reworded, merged or reordered.

- A herd question gate (`kind: question`, subject `herd:<id>/<job>`): one sentence naming the job and what it needs decided, then the form with the gate question's `label`.
- Any other gate: its full context.
- A milestone gate: **Approve** / **Revise** / **Spawn a reviewer**; Revise collects feedback (or "see pane") into `note`.

Submit each `value` verbatim; free text rides the `note`.
`herd_gate_answer` records `by: shepherd`. Answer for the agent only when
the answer is literally in the brief you wrote, and never a gate whose
context is `boards@1`: whether an evidence board may go public is decided
by a human looking at it, so that gate is presented whatever the brief
says. A human answer fitting no
option goes as `{"writeIn": "<their words>"}` if the question was opened
with `writeIn`, else ask them to pick. When the user parks a gate,
`herd_gate_park` takes it off the open list; it stays answerable with
`herd_gate_answer` until answered or closed. A later answer takes its id
from the job's `herd_status` row: `lastGate`, with `lastGateStatus:
parked`; relay it verbatim.
