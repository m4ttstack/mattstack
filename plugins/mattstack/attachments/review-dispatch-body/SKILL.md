---
name: review-dispatch-body
description: "Fresh-context dispatch rule and standard blocks, inlined by the review verbs. Not for direct invocation."
disable-model-invocation: true
---

# Review dispatch

## The rule

Code judgment never happens in the context that wrote, triaged, or set up
the code. This context builds the dispatch; a fresh context renders the
verdict.

No exemption for a small diff, a hurry, or code you wrote yourself. An
inline self-review lets a stale assumption ship, because the same context
re-derives its own assumptions and nods at them. Reading harder does not
fix it: a careful, tool-assisted read of your own change is the authoring
context grading itself at higher confidence. The fresh context exists to
test assumptions, not inherit them.

Time pressure argues for dispatching sooner, never for judging inline.
Building the dispatch takes one message.

## Caller inputs

- which shape: reviewer or adjudicator
- reviewer: the commit range, plus a one-or-two-sentence description of the
  change
- adjudicator: the numbered threads (file:line plus note chains), plus the commit range
- the requirements or acceptance criteria the change is judged against
- optional: an already-filled domain addendum block
- optional: setup observations already gathered (commands run, values seen)

## Standard blocks

Append to every dispatched prompt, in this order, after its filled template:

1. Setup observations: `## Already checked before dispatch (fold in; do not
   redo)`, followed by the caller's observations, or `none`.
2. The caller's addendum block, verbatim, when provided.
3. No fabrication: do not invent requirements, files, or findings; if the
   diff, the requirements, or a referenced file cannot be read, say so for
   that item and stop rather than guessing.

Observations travel exactly once: block 1 carries them unless the caller's
addendum claims them through a `{SETUP_OBSERVATIONS}` placeholder, in which
case fill that placeholder and skip block 1. A `{SETUP_OBSERVATIONS}`
placeholder with nothing to carry is filled `none`.

## Reviewer shape
