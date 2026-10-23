---
order: 4
---

# What the graph cannot show

- Review verbs produce judgment and execute posting; they never decide
  what posts.
- The draft is presented once, after verify and any demotion, then the
  severity levels present in one line, for example "Findings: Critical
  (2), Important (1); 3 findings.", skipping empty levels, counted on the
  demoted draft before any selection.
- A caller's decided selection is `{findings, outcome}` or legacy
  `{tiers, outcome}` (plus `texts` and `summaryText` when the human edited
  drafts, and `replies` and `restored: [{id, title, body, file, line,
  changed}]` on a re-review), with the decider to use. Posting
  gets it as `{findings: <ids>, disposition: <outcome>}` (legacy `{levels:
  <tiers>, disposition: <outcome>}`), restored findings selected, never
  deselected.
- The post record, `gate_record {runDb, stage, scope: post, shape: post}`,
  comes only once the review is up (by the submit, `gh`, or the human on a
  take): rt reads the latest post decision as what posted. Pass `gateId`
  for an answered gate, or the caller's selection as `answers` with its
  named `decidedBy`; the tool builds the record.
- A hold is one `run_hold` (`reason` the human's words or the quoted
  error, `decidedBy` the answer's by, `pane` for an error); then the turn
  ends. A gate that comes back `closed` is a hold, reason "gate closed".
- `run_close` takes `outcome: done` after the post record, or `abandoned`
  with `reason: <why; what already posted>` on a hand back.
- A fetch, diff or `gh pr diff` that errors is a hold quoting the error.
