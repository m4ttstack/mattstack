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
is the caller's job (review provisions an MR-head checkout at verify and
repro depth); run checks in the one you are handed.

## Commit to a review depth

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
  significant or user-visible changes. A browser screenshot is taken as the
  section A browser screenshot at repro below says.

EVIDENCE CHECK: `screenshot` if a user can see the change, `data-shape` for
a backend-only change, `none` only when there is no runtime surface.

The tier is a recommendation: a different tier is an Iterate here answer at
the next gate, against a printed tier rather than a silent one.

## A browser screenshot at repro

A repro capture that is a browser screenshot follows Browser evidence
below, never another method, with the browser target the Criteria point
at (the `## Browser target` section of the pack's evidence fill), or every
block's default when nothing is bound. Walk its `Draw the boards` graph
once per review pass, with these values in place of a run's:

- stem: `review-<mr iid>-<case>-<before|after>`, `<case>` naming the view,
  plus the theme as Write one brief per board says; a self-review with no
  MR in hand puts its run id in place of `<mr iid>`.
- after `Reads right?` yes, the board is ready: skip `Crops listed?` and
  the redaction gate, which guard a board that leaves this machine, and a
  review's never does.

The board stays where the driver drew it,
`~/.fast-browser/screenshots/<stem>.png`, its bundle beside it. A review
keeps no evidence record and uploads nothing: never Record the board,
`evidence_record`, `evidence_attach` or `mr_upload`, and never a copy of
the board into a run's evidence folder or another upload root. Cite the
board's absolute path in the setup observations and in the review, and
compare it there with what the MR's description states, since no tool
reads an MR's uploaded image: its evidence entries' labels, captions and
claims, and whether the board shows the same outcome, or that the MR
states none. Never a pixel comparison. A Not drawn goes into the setup
observations as not captured, its reason quoted, and the review goes on.
