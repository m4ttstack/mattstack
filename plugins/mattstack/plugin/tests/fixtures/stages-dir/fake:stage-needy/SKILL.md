---
name: fake:stage-needy
description: "Use when testing pipeline resolution (slotted stage fixture)."
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh:*)
metadata:
  stage: "gates"
  stage-consumes: "-"
  stage-produces: "-"
  slots: "domain"
  slot-domain: "required tiering@1 -- fixture domain slot"
---

fixture body
