---
order: 3
props:
  rules:
    merge: add
    default: ""
---

# Domain rules

The domain rules run their own steps in their own order, every mechanical
move landing on this graph. If a rule below asks for a move this graph
marks STOP, take the off-script edge instead. A rule that keeps a capture
out of the record, or keeps a base with no waiver, yields to the evidence
record. On a browser case the domain's browser target supplies facts,
never steps: browser-evidence below does the capture, the board, the gates
and the bundle.

{{props.rules}}

When nothing is inlined above, the graph alone is the flow: no domain
steps or checks, no rebase, and no AFTER beyond a browser case's.
