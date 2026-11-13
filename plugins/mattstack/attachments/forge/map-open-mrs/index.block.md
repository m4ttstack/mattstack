---
name: map-open-mrs
disable-model-invocation: true
description: "Use when acting on all of the user's open MRs or PRs at once -- a batch sweep, rebase, or audit that needs each open item paired with the local worktree holding its branch."
type: pipeline-step
---

# map-open-mrs

Pair each open MR/PR with the local worktree holding its source branch,
so you can see what each open MR or PR has checked out locally. Discovery
only -- this skill never creates, rebases, or removes anything.
