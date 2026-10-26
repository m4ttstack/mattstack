---
node: pick_next_source
props:
  rules:
    merge: add
    default: ""
---

# Pick the next source or view

A failed capture (a blank page, a missing record, a wrong route) gets one
different attempt per round: another view, another record, the same
source.

{{props.rules}}
