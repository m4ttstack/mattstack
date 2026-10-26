---
order: 3
---

# Review off-script gates

Every off-script box opens gate-protocol's Off-script gate at site
`review` (scope `off-script:review:<n>`, `n` from 1 in this run), `context`
quoting the refusal verbatim, under the run, in this pane even when a board
owns the review gates.

Route: `action: handback` is hand back whatever `next` says; otherwise
`next: iterate` is iterate here (a retry with their note; each failed
retry opens a new gate), `hold` is `run_hold` with their words, `proceed`
is take. A hold's or hand-back's reason says what is on the MR; from the
submit, pending-comments or approval gate it always says whether this
review is posted (by the submit, by the human, partly, or outcome unknown)
and, on an approve, whether the approval is outstanding: what `This review
already on the MR?` reads on a resume.
