---
name: review
disable-model-invocation: true
description: "Use when reviewing someone else's MR or PR before it merges -- a pasted MR/PR link or !iid, 'review this MR', 'check my co-worker's change', 'is this MR solid'. For your own uncommitted work use self-review; for feedback on your own MR use receive-review."
type: pipeline-step
replaced-slots: [criteria, reviewer]
---

# review

The standalone entry for reviewing someone else's change. Follow the
graph's edges; a move it does not show is a question for a gate, never a
judgment call. Reads through the read tools and `gitlab_get` are part of
the step that needs them.
