---
order: 5
props:
  criteria:
    merge: replace
    default: ""
    contract: "review-criteria@1"
---

# Criteria

*If a rule below asks for a move this skill's graph marks STOP, take the off-script edge instead.*

The criteria below are the domain's review standards, when the pack
binds them: evaluate the triage lines they declare against this change,
and pass their addendum with `{TRIAGE_FLAGS}` (those resolved values) and
`{SETUP_OBSERVATIONS}` (what was already gathered, else `none`) filled, the
rest verbatim, each `@key` written as its resolved path. No depth block here; the addendum informs the per-thread
verdicts.

{{props.criteria}}
