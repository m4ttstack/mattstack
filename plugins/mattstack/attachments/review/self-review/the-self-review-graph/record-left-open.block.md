---
node: record_left_open
---

# Record the finding as left open

No more attempts this run; keep its last failing output for the final
message and any hand-back. Undo only this finding's attempts, from its
saved patch; never restore a file from HEAD or the index, since the diff
under review includes uncommitted work. Mark its failing test skipped,
the finding id in its name or reason (or remove it), so the suite is green
before the next finding.
