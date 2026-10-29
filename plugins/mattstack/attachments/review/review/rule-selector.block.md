---
order: 9
props:
  rule-selector:
    merge: replace
    default: ""
    contract: "rule-selector@1"
---

# Rule selector

*If a rule below asks for a move this skill's graph marks STOP, take the off-script edge instead.*

{{props.rule-selector}}

{{include:review-rules-select-body}}
