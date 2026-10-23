---
order: 5
props:
  criteria:
    merge: replace
    default: ""
    contract: "review-criteria@1"
---

# Criteria

{{props.criteria}}

The Criteria section above is the domain's review standards, when the pack
binds them: evaluate the triage lines it declares against this change, and
pass its addendum with `{TRIAGE_FLAGS}` (those resolved values) and
`{SETUP_OBSERVATIONS}` (what was already gathered, else `none`) filled, the
rest verbatim. No depth block here; the addendum informs the per-thread
verdicts.

**One dispatch, all threads together**, whatever the slots bind: related
comments must be judged with shared context, or wrong conclusions and a
wrong implementation follow. Per thread it returns `valid` / `pushback` /
`needs-clarification`, plus that entry's relations.

{{include:review-dispatch-body}}
