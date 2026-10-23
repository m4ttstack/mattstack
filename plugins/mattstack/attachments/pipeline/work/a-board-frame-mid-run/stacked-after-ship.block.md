---
node: stacked_after_ship
---

# Ship already pushed this attempt (position is watch-ci)?

Yes when the position's stage is watch-ci, its lease held or between
pushes. Write the cause as a run note and commit nothing: watch-ci checks
that the pushed sha is the branch head, and an unpushed local commit can
misdirect that check. The human answering close takes it back through
ship with Iterate.
