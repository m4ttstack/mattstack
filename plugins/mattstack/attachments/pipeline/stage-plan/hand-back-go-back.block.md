---
node: hand_back_go_back
---

# Hand the Go back answer to the orchestrator

End the stage handing back `{to, note, decidedBy}`: `to` is the gate's
`to` answer (the one earlier stage when `to` was not shown), `note` their
words, `decidedBy` the gate result's `decidedBy`. Write nothing else: the
orchestrator applies it with `run_resolve`.
