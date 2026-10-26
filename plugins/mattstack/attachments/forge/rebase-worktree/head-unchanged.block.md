---
node: head_unchanged
label: Head unchanged
---

# Head still the old head?

The old head here is the conflict result's `newHead`: the branch ref when
the rebase paused, which differs from `oldHead` when rt sync first reset a
GitLab-rebased branch to origin. HEAD still equal to it means the human
aborted in their pane, never "already current".
