---
node: run_stores_source
label: Stored plan source
---

# The run stores a respond-plan source for the handed plan?

- **Yes:** record the plan against those cards.
- **No** (an unset-key error: a gate parked before this version, no run
  line, or a refused resume): build the open with no new adjudication or
  drafts, each card from the handed `--report`'s verdict table row
  (verdict, recommended action, reply) and the thread read (id,
  `file:line`, author, note chain). It has exactly the threads the plan
  names, each under the question id the plan keys it by (`thread-<n>`),
  plus `code-changes`. A thread the report has no row for gets `reply:
  {"kind": "none"}`, so its `reply:` answer without `text` records as an
  override. Store it with the hand-back `gate_open`, then record; never
  record the plan without the stored source.
