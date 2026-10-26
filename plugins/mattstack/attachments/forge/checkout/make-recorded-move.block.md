---
node: make_recorded_move
---

# Make the recorded move once

Exactly the move the selection recorded, once. The move must produce the
worktree path; an answer that only fixes the cause ("I started the daemon,
go ahead") is **Iterate here**, not **Take**. Its result decides the next
node: success goes to the report with the path it made; a failure is
reported, never a second off-script gate.
