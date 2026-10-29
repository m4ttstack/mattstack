---
node: fix_finding
---

# Fix the finding and run the tests

Before the first attempt on a finding, save a patch of every file its
attempts will touch, in the review scratch dir `select_rules` made when it
made one, otherwise in a new directory inside this session's scratchpad
(outside the repo), so they can be undone. Make the smallest fix, then run
the finding's test and the depth's checks.

Charge `fix:<finding id>:<round>` once, right after a failed attempt. Back
in this loop after a compaction or resume with no fresh failure in hand,
read the stored count with `increment: 0` and go on from it. Never charge
a failure twice or restart a count by hand.
