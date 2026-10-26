---
node: rerun_after_rebase
---

# Rerun the stage's tests on the rebased branch

The tests the current stage has already run this session, on the
rebased branch. The rebase rewrote commits the MR already holds, so
ship's next push takes force-with-lease. Never push here.
