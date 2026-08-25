---
name: ship
disable-model-invocation: true
description: "Use when work on the current branch should leave the machine as an MR or PR -- 'ship this', 'ship it', 'push and open an MR', 'create the PR' -- outside a pipeline run."
type: pipeline-step
slots:
  domain: { contract: ship-domain@1, required: false }
---

# ship

The standalone entry for shipping the current branch. Same flow as the
pipeline's ship stage, reached directly: target from the checkout, no uow
record.

## 1. Establish the target

Current branch (`git branch --show-current`); refuse the default branch.
Uncommitted changes: show them and ask commit / stash / abort -- never
silently commit. Confirm the branch has the commits the user means to
ship (`git log --oneline @{upstream}.. 2>/dev/null || git log --oneline -5`).

## Domain rules

{{slot:domain}}

When nothing is inlined above, follow the generic path below.

## 2. Ship

**Domain rules above:** follow them for the shipping flow.

**Generic path:** push with `git push -u origin <branch>`, then
create the MR/PR against the repo's default branch
(`glab mr create --fill` or `gh pr create --fill`), title from the
branch's commits. Print the URL.
