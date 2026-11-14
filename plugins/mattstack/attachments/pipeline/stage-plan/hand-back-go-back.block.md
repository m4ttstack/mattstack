---
node: hand_back_go_back
label: Hand back
---

# Hand the Go back answer to the orchestrator

End the stage handing back `{to, note, decidedBy}`: `to` is the
answer's `to` (the one earlier stage when it names none), `note` their
words, `decidedBy` the gate result's `decidedBy`. Write nothing else: the
orchestrator applies it with `run_resolve`.
