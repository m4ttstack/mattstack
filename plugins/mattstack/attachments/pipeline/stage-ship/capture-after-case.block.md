---
node: capture_after_case
label: Capture after next
props:
  rules:
    merge: add
    default: ""
---

# Capture the AFTER for the next case the domain names

Per case in the record, the same view as its BEFORE on the pushed sha (a
v1 record's BEFORE is the case `case`); any other capture the domain names
is a new case with its own `id` and `label`, and so is each item on the
`owed-evidence` list not yet marked at the pushed sha (Graph notes, Owed
evidence). A case with no AFTER after
three tries goes on, the description saying what was tried. Unbound, a
case that is not a browser case has no AFTER: it is skipped, so a later
browser case still runs. An owed item skipped this way stays owed, so
`Gate owed-evidence` asks about it once the description is written. A
method or an environment the developer's answer there named is how that
item is captured, the unbound skip set aside; an environment that is not up is
a skip at once, with no attempt. A capture is never uploaded outside the record.

{{props.rules}}
