---
name: fake:stage-grab
description: "Use when testing pipeline resolution (provision fixture)."
disable-model-invocation: true
metadata:
  stage: "provision"
  stage-consumes: "ticket repo"
  stage-produces: "branch worktree"
---

fixture body
