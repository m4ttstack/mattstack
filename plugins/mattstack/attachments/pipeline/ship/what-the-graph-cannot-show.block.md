---
order: 3
label: Graph notes
---

# What the graph cannot show

- **Force** only on the "yes" edge of "Push needs force-with-lease
  (ship)?": a rebase finished this pass and the upstream already held the
  commits it rewrote.
- **The lease.** The pushes' `<mr>` is the `mr` field when the run
  already records one (a reopened run, a repair push): then both pushes
  pass `leaseMrUrl: <mr>`.
- **`targetBranch`** is the target `branch_stack` resolved before the
  gate (on `stackStore: "unavailable"` or an error, the default branch),
  never guessed. A GitHub PR takes it as `--base`. The domain rebase goes
  onto `origin/<target>`, so a stack member never replays its parent's
  unmerged commits.
- **The MR.** Keep `mr_create`'s `url` as `mrUrl` for every later write,
  and print it. `draft: false`, or no `--draft`, only when the gate said
  ready; the title comes from the branch's commits. `existing: true` is an
  MR already open on the branch, left as found (nothing this call passed
  applied); a `targetBranch` other than the resolved one is named in the
  report. After `url: null`, the re-call's `existing: true` MR is the first
  call's: the report says squash is unset when it was asked and no result
  said it applied.
- **Hold** at any gate records `run_hold`: the gate-write stage, the gate
  as `reason`, `decidedBy` as the answer recorded it. The turn ends naming
  the run and the gate.
- **A board revision asked at a gate** (a note at the ship gate, say) runs
  browser-evidence's Revise a board steps 1 to 5; the record and the
  attach (its steps 6 and 7) follow this graph's own `Record the evidence
  (evidence-record)` and `Attach the evidence (evidence-record)` boxes. On
  a run that already shipped, the run graph's revise entry runs every
  step.
