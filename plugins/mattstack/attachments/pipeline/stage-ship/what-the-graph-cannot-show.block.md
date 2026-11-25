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
  `decidedBy` as the answer recorded it. Every path into it starts at a
  human's answer; a decision still pending is a gate.
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
  stage, one item per line:
  - `- [ ] <what to capture> (<finding id>)` while owed;
  - `- [ ] on <environment>: <what to capture> (<finding id>)` once put off
    to an environment;
  - `- [x] <short sha>: <what to capture> (<finding id>)` once captured on
    that pushed sha, `<pushed sha> accepted from <earlier sha>` in place of
    the sha when the developer accepted the earlier capture;
  - `- [x] follow-up: <what to capture> (<finding id>)` once moved to a
    follow-up.

  An unset field (`run_field_get` errors) or `-` owes nothing. A follow-up
  is settled for good. A mark at an earlier sha stands, unchanged, while
  `git diff --name-only <that sha> <pushed sha>` lists only documentation
  files (prose no build reads) and test files; any other file listed, or a
  sha git cannot read, makes the item owed and it is captured again. An
  item with no mark is owed. Each owed item is a case in the
  AFTER loop, its own `id` (`owed-<finding id>`, lowercase) and its text as `label`,
  captured like any other case the domain names, on its environment when
  it names one. The write after the loop keeps every item and marks only
  those captured this pass; only an answer at `Gate owed-evidence` settles
  an item any other way, or puts one off. A put-off lasts until this pass
  ends: the resume captures the item, and one still owed then is asked
  about again.
- **Revising a board.** A board revision asked at a gate (a note at the
  ship gate, say) runs browser-evidence's Revise a board steps 1 to 5.
  Steps 6 and 7 are this graph's own boxes: `Record the evidence
  (evidence-record)` records the revised board, its outcome read as in the
  graph, and `Attach the evidence (evidence-record)` uploads it when the
  flow reaches it, never a separate upload.
