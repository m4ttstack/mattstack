---
node: hand_back_severity
---

# Hand back the severity line and the open's paths

A caller that owns the gates (a board wrapper says so when it delegates)
gets no gate from this verb. Hand back the severity line; the absolute
paths of `<dir>/review-post.open.json` (its source beside it as
`review-post.source.json`) and of this skill's vendored
`${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`; any `droppedContexts`; and on
GitLab the MR head sha this review read (`mr_view`'s `mr.sha`). Then wait
for its `{findings, outcome}` (plus `replies` and `restored` on a
re-review) or its hold.
