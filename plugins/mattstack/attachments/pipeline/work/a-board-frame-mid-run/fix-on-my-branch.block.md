---
node: fix_on_my_branch
---

# Fix it test-first and commit on this run's branch

Read the failed jobs the triage names, then a failing test, the fix and
a commit in the run's worktree, as part of the current stage: it is the
stage's work, not a separate loop. Never push: ship pushes what `commits`
names, so the map rewrites `commits` after the fix. Never touch the
stacked MR's branch: its fix, if yours, lands on this branch.
