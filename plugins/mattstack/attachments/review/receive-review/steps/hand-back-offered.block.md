---
node: hand_back_offered
---

# Hand back the offered replies and the respond-post open's path

**A caller that owns the gates**: open nothing in the pane. Hand back the
offered replies plus the absolute paths of `<dir>/respond-post.open.json`
(its source beside it as `respond-post.source.json`) and of this skill's
vendored `${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`, then wait for its
`{post}` (its `.questions` end with `next`, which a caller with its own
navigation drops). The `{post}` records first, then the post side acts;
hand back which replies posted.
