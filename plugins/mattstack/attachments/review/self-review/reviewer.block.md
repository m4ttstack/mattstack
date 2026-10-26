---
order: 9
props:
  reviewer:
    merge: replace
    default: ""
    contract: "reviewer-dispatch@1"
---

# Reviewer

*If a rule below asks for a move this skill's graph marks STOP, take the off-script edge instead.*

{{props.reviewer}}

{{include:review-dispatch-body-after}}
