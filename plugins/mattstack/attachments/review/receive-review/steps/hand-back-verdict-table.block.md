---
node: hand_back_verdict_table
---

# Hand back the verdict table and the respond-plan open's path

**A caller that owns the gates** (a board wrapper says so when it
delegates): open nothing in the pane. Hand back the verdict table plus the absolute
paths of `<dir>/respond-plan.open.json` (its source beside it as
`respond-plan.source.json`) and of this skill's vendored
`${CLAUDE_SKILL_DIR}/scripts/gate-ctx.sh`; the caller opens its gate from
the open file's `.questions` and `.context`, builds its pane form from the
file's `pane` key, then hands `{plan}` back. When the result says
`contextDropped` or lists `droppedContexts`, say so: the caller writes
`gate-1-context: dropped` into its own report.

The caller's `{plan}` comes back to this pane, in the same conversation:
the re-entry goes on from this box with the `runDb` already in hand, and
its first call is the record, `gate_record {runDb, stage, scope:
respond-plan, shape: respond-plan, answers: <the plan>, decidedBy}`, with
`contextDropped: true` when the open's result or the saved report says
so. A fresh pane, with no hand-back in its conversation,
starts at the trigger and resumes through the run line.
