---
node: dispatch_reviewer
---

# Dispatch the fresh reviewer on your own diff

The review flow's Dispatch the review, on the self-review diff as it stands
now, with the requirements and a label (the branch or task name). One
dispatch, never skipped, however small the change.

The commit range (merge base to HEAD) covers commits only. When the tree
has uncommitted changes or untracked files, write the self-review diff to
`self-review.diff` in the review scratch dir (one new directory in this
session's scratchpad, made here when none exists yet) and hand it to the
dispatch as the diff file (Review dispatch's Standard blocks), so the
reviewer judges that file, not the range.
