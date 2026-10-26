---
name: self-review
disable-model-invocation: true
description: >-
  Use when reviewing, sanity-checking, or gut-checking work this session
  produced on the current branch, before shipping or between tasks --
  "review my work", "is this solid?", "gut-check my changes",
  "self-review this branch". For a teammate's MR/PR use the domain's
  review skill instead.
type: pipeline-step
replaced-slots: [criteria, reviewer]
---

# Self-review (your own branch)

Review the change you just made, between tasks or right before shipping:
point the review flow below at the current branch, then act on the draft it
returns. Follow the graph's edges; a move it does not show is a question
for a gate, never a judgment call.
