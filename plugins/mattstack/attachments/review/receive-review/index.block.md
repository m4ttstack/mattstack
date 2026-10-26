---
name: receive-review
disable-model-invocation: true
description: >-
  Use when processing review feedback received on your OWN MR/PR --
  "address the review comments", "go through the reviewer's comments and
  reply", "respond to the review", "handle the feedback on my change".
  For someone else's change use the domain's review skill; for your own
  branch before it has feedback use the self-review flow.
type: pipeline-step
replaced-slots: [criteria, reply-rules, reviewer]
---

# Receive review (feedback on your own change)

The review comments left on **your own** change: pull the open threads,
judge each against the codebase, decide what to change, reply. The skill
exists for the two things agents get wrong on their **own** change:
adjudicating the comments in the context that wrote the code (author
bias), and performative agreement leaking into the replies.

The graph below is the run: follow its edges. A move it does not show is a
question for a gate, never a judgment call. Reads through the read tools
and `gitlab_get` are part of the step that needs them, not moves.
