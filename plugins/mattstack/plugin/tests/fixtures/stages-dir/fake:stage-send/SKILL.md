---
name: fake:stage-send
description: "Use when testing pipeline resolution (ship fixture)."
disable-model-invocation: true
metadata:
  stage: "ship"
  stage-consumes: "commits ticket"
  stage-produces: "mr"
---

fixture body
