---
order: 9
props:
  reviewer:
    merge: replace
    default: ""
    contract: "reviewer-dispatch@1"
---

# Reviewer

{{props.reviewer}}

{{include:review-dispatch-body-after}}

{{include:review-core-body-tail}}
