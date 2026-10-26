---
name: checkout-and-open
disable-model-invocation: true
description: "Use when reviewing someone else's branch in an editor in one step -- 'check out that branch and open it', 'open this MR locally' -- given a branch, MR/PR link, or ticket id. For a checkout without an editor, use checkout."
allowed-tools:
  - Bash(rt worktree:*)
  - Bash(git fetch:*)
  - Bash(git worktree list:*)
  - Bash(gh pr view:*)
  - Bash(command -v:*)
type: pipeline-step
---

# checkout-and-open

The one-step "review someone's code" path: get a teammate's branch into a
local worktree, then open it in an editor.
