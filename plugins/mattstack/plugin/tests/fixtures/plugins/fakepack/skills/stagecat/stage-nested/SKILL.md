---
name: stage-nested
description: "Use when testing pipeline resolution of a plugin stage inside a category dir."
disable-model-invocation: true
metadata:
  stage: "provision"
  stage-consumes: "ticket repo"
  stage-produces: "branch"
---

fixture body
