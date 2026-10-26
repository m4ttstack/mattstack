---
node: head_checkout_in_hand
---

# MR-head checkout in hand?

In hand: a checkout already at the MR head, one a caller handed or this
pane's own tree. `read` depth runs nothing: yes. At `verify` or `repro`
with none, provision one (`repoName` this checkout's path, `branch` the
source branch, `reuse: true`) and run every check in its `path`, never
changing this pane's directory; rt disposes it after the merge, never you.
A refusal is quoted in the setup observations, the setup checks and the
verify command check noted as not run.
