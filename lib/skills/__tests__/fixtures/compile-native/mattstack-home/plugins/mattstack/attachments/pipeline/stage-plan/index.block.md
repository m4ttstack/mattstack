---
name: stage-plan
description: "stage-plan"
type: pipeline-step
metadata:
  stage: plan
  stage-consumes: ticket
  stage-produces: approach
replaced-slots: [domain]
props:
  rules:
    merge: add
    default: ""
---

{{stage.fields}}
{{props.rules}}
