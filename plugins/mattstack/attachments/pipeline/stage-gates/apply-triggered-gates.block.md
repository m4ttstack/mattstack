---
node: apply_triggered_gates
props:
  rules:
    merge: add
    default: ""
---

# Apply every triggered pre-implementation gate

Each gate the domain rules below trigger for the paths this work touches,
now, before implement. Ship-time gates run again inside the ship stage's
domain flow: firing here does not discharge them.

{{props.rules}}
