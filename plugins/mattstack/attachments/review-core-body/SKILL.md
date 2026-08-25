---
name: review-core-body
description: "Shared review flow body, inlined by the review verbs. Not for direct invocation."
disable-model-invocation: true
---

# Review core

Size the change, set up to that depth, dispatch the judgment to a fresh
context, return a draft. The caller resolved the target and owns what
follows.

## Caller inputs

- The diff source, already confirmed to resolve. With no named base: the
  branch point (`git merge-base origin/HEAD HEAD`, falling back to the
  default branch by name), plus uncommitted changes for own-branch flows.
- The requirements, from the ticket or task description.
- A human-readable label for the change.

Take these as given: never re-resolve, never fabricate. An absent,
unreadable, or mismatched input is the draft's first finding. The checkout
is the caller's job; run checks in the one you are handed.

## 1. Commit to a review depth

<HARD-GATE>
Print this block in visible output before any setup: before a test runs, a
checkout is touched, or the diff is read. A commitment, not reasoning.
</HARD-GATE>

> REVIEW DEPTH: read | verify | repro -- \<one-line reason\>
> EVIDENCE CHECK: screenshot | data-shape | none -- \<why\>
> \<provider triage lines, when the criteria slot is bound\>

- **read** -- diff only, no build or run: small, self-contained, or
  pure-logic changes with clear requirements.
- **verify** -- the project's tests and checks against the checkout, then
  review: moderate changes.
- **repro** -- also run the change and capture before/after evidence with
  the project's tooling, compared against what the MR/PR attached:
  significant or user-visible changes.

EVIDENCE CHECK: `screenshot` if a user can see the change, `data-shape` for
a backend-only change, `none` only when there is no runtime surface.

The tier is a recommendation: the developer can raise or lower it, against
a printed tier rather than a silent one.
