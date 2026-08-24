---
name: stage-unregistered
description: "Use when testing pipeline resolution of a stage moved out of skills/ into attachments/, one category level deep."
disable-model-invocation: true
metadata:
  stage: "provision"
  stage-consumes: "ticket repo"
  stage-produces: "branch"
---

fixture body
