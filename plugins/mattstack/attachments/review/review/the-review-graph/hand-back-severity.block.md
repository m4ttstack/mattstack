---
node: hand_back_severity
---

# Hand back the severity line and the open's paths

A caller that owns the gates (a board wrapper says so when it delegates)
gets no gate from this verb. That caller runs in this same session, so
handing back means stating these and then taking the caller's next step in
the same turn: the severity line; the absolute paths of
`<dir>/review-post.open.json` (its source beside it as
`review-post.source.json`) and of this skill's vendored
`${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`; any `droppedContexts`; and on
GitLab the MR head sha this review read (`mr_view`'s `mr.sha`). The turn
ends at the caller's gate. Its `{findings, outcome}` (plus `replies` and
`restored` on a re-review) or its hold brings you back at `Review caller's
answer?`.
