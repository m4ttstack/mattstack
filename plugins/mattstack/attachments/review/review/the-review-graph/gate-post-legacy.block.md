---
node: gate_post_legacy
kind: gate
label: Legacy review post
---

# Gate review-post, legacy: tiers, outcome and next

No report json leaves nothing to build from. Gate-protocol's Runs
integration from `Trigger: a site reaches its gate`: `gate_ask {questions,
kind: review-post, scope: post, context, runDb, stage}`, `context` the severity line verbatim, questions
`tiers` (multi-select over the levels present, all pre-selected), then
`outcome` and `next` as in the extras. It records nothing either; the post
record reads `tiers` as the legacy selection.
