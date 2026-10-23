---
order: 1
props:
  rules:
    merge: add
    default: ""
---

# Domain rules

The domain rules supply the gates and the paths that trigger them; they
sit below or in the section Apply every triggered pre-implementation gate.
Where a domain step names a move the graph above marks STOP (inventing a
gate), the STOP node wins.

{{props.rules}}
