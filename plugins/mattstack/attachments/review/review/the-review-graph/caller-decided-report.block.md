---
node: caller_decided_report
---

# Caller handed a decided selection and the report it decided on?

Yes when the caller hands a decided selection (`{findings, outcome}`, or
legacy `{tiers, outcome}`) together with the `--report` the human decided
it on: the review already ran in an earlier pane, a board's fresh pane or
a resume of this run included. Go straight to posting. The selection may
carry `texts` (`{<finding id>: <text>}`, the human's edits) and
`summaryText` (the summary line's edit); Compose takes them as it takes
the gate answers' `texts` and the `outcome` answer's `text`. Compose reads
each selected finding's draft, anchor and tier from the report's json
sibling (the report itself for a legacy selection) as written. Print no depth
block, fetch, diff, provision or dispatch nothing, and never rewrite the
report or its json: a second pass forms new findings whose ids and
anchors are not the ones the human picked. A selected finding id the json
lacks means the selection was decided on another revision of the report:
hold, quoting the missing ids, and never post a partial set. On a resumed
run the post still reads the MR first (`This review already on the MR?`).
No: a
selection handed with no report, or none handed, goes on to the review.
