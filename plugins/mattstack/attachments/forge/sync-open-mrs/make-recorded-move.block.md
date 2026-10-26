---
node: make_recorded_move
---

# Make the recorded move once per listed branch

Exactly the move the selection recorded, once for each listed branch. Each
branch's result moves it to pushed or leaves it push failed with the new
error quoted; a failure is reported, never a second off-script gate.
