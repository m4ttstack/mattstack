---
name: ship
disable-model-invocation: true
description: "Use when work on the current branch should leave the machine as an MR or PR -- 'ship this', 'ship it', 'push and open an MR', 'create the PR' -- outside a pipeline run."
allowed-tools:
  - Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
type: pipeline-step
slots:
  domain: { contract: ship-domain@1, required: false }
metadata:
  slots: "domain"
  slot-domain: "optional ship-domain@1 -- owns the domain's shipping conventions: MR/PR description shape, target branch, draft rules, labels, linked tickets"
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

## 2. Resolve the slot

In a compiled skill (see the header comment), bindings are already resolved
-- do not run resolve-args.sh.

Run `"${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh"`; nonzero exit: print
`errors` verbatim and stop. Print one provenance line: the domain binding
and its manifest path, or "domain: unbound (generic ship)".

## 3. Ship

**Domain bound:** read the SKILL.md at `resolved.domain.path` and follow
its shipping flow.

**Unbound (generic):** push with `git push -u origin <branch>`, then
create the MR/PR against the repo's default branch
(`glab mr create --fill` or `gh pr create --fill`), title from the
branch's commits. Print the URL.
