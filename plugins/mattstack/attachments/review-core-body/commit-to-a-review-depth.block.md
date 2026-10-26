---
order: 2
---

# Commit to a review depth

<HARD-GATE>
Print this block in visible output before any setup: before a test runs, a
checkout is touched, or the diff is read. A commitment, not reasoning.
</HARD-GATE>

> REVIEW DEPTH: read | verify | repro -- \<one-line reason\>
> EVIDENCE CHECK: screenshot | data-shape | none -- \<why\>
> \<provider triage lines, when the pack binds criteria\>

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
