---
node: open_off_script_gate
---

# Open the self-review off-script gate: a fill asks for a move this graph forbids

A rule under Criteria or Reviewer asks for a move the graph marks STOP (an
inline verdict in place of the dispatch, say). Open gate-protocol's
`## Off-script gate` at site `self-review` (scope
`off-script:self-review:<n>`), `context` quoting the rule, under the run.
Route: `action: handback` is hand back whatever `next` says; otherwise
`next: iterate` is iterate here, `hold` is hold, `proceed` is take.
