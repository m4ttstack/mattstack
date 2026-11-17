---
order: 1
label: Graph notes
---

# What the graph cannot show

- **`pushed`** hands the watch-ci stage `git_push`'s `sha`, and its
  `priorPipelineId` only when the push moved the branch (commits listed
  before the gate, a commit by this stage since, or a forced push); else
  `null`, or the watch waits for a pipeline that never comes. A push that
  moved nothing relies on the sha's own pipeline matching by sha; on a
  fast-forward merge train that pipeline is unprovable, and the watch's
  waiting budget ends the watch.
- **The lease.** The pushes' `<mr>` is the `mr` field read at entry: when it is set
  (a repair push after a red CI), both pushes pass `leaseMrUrl: <mr>`.
  `refused: "lease_held"` means another attendant holds the MR's CI lease:
  report the `holder` and stop, releasing nothing; that lease is someone
  else's.
- `hold` records `run_hold`: `reason` their words or the gate,
  `decidedBy` as the answer recorded it.
- **`targetBranch`** is what `branch_stack` resolved; a default branch is
  read from git, never guessed. `mr_create` takes it as `targetBranch`, with `draft` unless the gate
  said ready, on both forges. The rebase
  goes onto `origin/<target>`, so a stack member never replays its
  parent's unmerged commits.
- **The MR.** `mr_create`'s `url` is `mrUrl` from here on. `existing:
  true` is an MR already open, nothing passed applied (as the re-call
  after `url: null` returns the first call's MR). The return names both
  targets when its `targetBranch` differs from the resolved one, and says
  squash is unset when asked and never applied.
- **Owed evidence.** `owed-evidence` is the list self-review left for this
  stage, one item per line: `- [ ] <what to capture> (<finding id>)`
  while owed, `- [x] <short sha>: <what to capture> (<finding id>)` once
  captured on that pushed sha. An unset field (`run_field_get` errors) or
  `-` owes nothing. Every item not marked at the sha this pass pushed is
  owed: a CI fix or any other commit since its mark moves the pushed sha,
  so it is captured again. Each owed item is a case in the AFTER loop, its
  own `id` (`owed-<finding id>`) and its text as `label`, captured like any
  other case the domain names; its capture never moves to the
  description as a promise. The write after the loop keeps every item and
  marks only those captured this pass. An item still owed after the loop
  holds the stage once the description is written, naming each item; this
  stage never finishes with one owed.
- **Revising a board.** A board revision asked at a gate (a note at the
  ship gate, say) runs browser-evidence's Revise a board steps 1 to 5.
  Steps 6 and 7 are this graph's own boxes: `Record the evidence
  (evidence-record)` records the revised board, its outcome read as in the
  graph, and `Attach the evidence (evidence-record)` uploads it when the
  flow reaches it, never a separate upload.
