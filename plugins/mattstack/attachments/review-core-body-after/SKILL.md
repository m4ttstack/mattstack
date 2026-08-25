---
name: review-core-body-after
description: "Shared review flow body between the criteria slot and the dispatch, inlined by the review verbs. Not for direct invocation."
disable-model-invocation: true
---

The Criteria section above carries the domain's review standards when the
pack binds them; nothing there means no triage lines and no addendum.
Evaluate each triage line it declares (`NAME: <values> -- <observable
predicate>`) and print the resolved line in the block. Its addendum goes to
the dispatch with two placeholders filled -- `{TRIAGE_FLAGS}` (those values),
`{SETUP_OBSERVATIONS}` (the setup observations, or `none`) -- everything else
verbatim.

## Set up for the depth

Run what the chosen depth defines. Record commands, output, values seen,
evidence compared: observations feed the dispatch and the draft, so a check
with no recorded result was not run.

## Dispatch the review

**REQUIRED SUB-FLOW:** the review dispatch flow below, reviewer shape. Hand
it the full payload:

- a one-or-two-sentence description of the change
- the requirements
- the commit range
- the setup observations, already gathered above
- the filled criteria addendum, when the slot is bound

It owns the template, the subagent, and the standard blocks. Judgment forms
there, not here: whoever sized this change carries assumptions about it, and
reading the diff here inherits them rather than tests them. No exemption for
a small diff, a clear requirement, or your own code.
