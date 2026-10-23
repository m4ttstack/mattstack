---
node: capture_after_case
label: Case AFTER capture
props:
  rules:
    merge: add
    default: ""
---

# Capture the AFTER for the next case the domain names (ship)

For each case in the record, the same view as its BEFORE, on the sha just
pushed; a v1 record's BEFORE is the case `case`. Any other capture the
domain names is a new case with its own `id` and `label`, as is each AFTER
when the record has no BEFORE. A case whose third capture fails goes on
without its AFTER, and the description says what was tried. The record is
this run's (own or inherited `runDb`). Unbound, a case that is not a
browser case (above) has no AFTER: it is skipped, so a later browser case
still runs.

{{props.rules}}
