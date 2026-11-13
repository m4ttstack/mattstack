---
name: map-open-mrs
disable-model-invocation: true
description: "Use when the user wants to see each of their open MRs or PRs with the local worktree holding its branch."
type: pipeline-step
---

# map-open-mrs

Pair each open MR or PR with the local worktree holding its source branch,
so you can see what each open MR or PR has checked out locally. Discovery
only -- this skill never creates, rebases, or removes anything.
