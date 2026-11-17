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

The brief adds two asks, since the fix loop reads both from the draft:

- Mark a finding a judgment call only when fixing it needs a decision the
  author cannot make from the requirements and the code (product intent,
  a scope the requirements rule out): its fix line starts
  `Judgment call:` and a one-line reason. Every other finding gets fixed.
- For a finding about code this change did not write, add
  `Reachable from this change: yes` when the change calls it, feeds it
  new inputs or exposes it to new users, else `no`.

Read `git rev-parse HEAD` before the dispatch and hold that sha; right
after the dispatch, record it as `self-review-head` (the next node), never
a fresh read, so a commit that lands while the reviewer works stays
outside what counts as reviewed and the next re-review covers it.
