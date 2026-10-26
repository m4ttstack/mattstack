---
node: executing_handed_plan
---

# Executing a caller-handed {plan}?

A caller-handed `{plan}` not yet spent is recorded, never re-adjudicated.
The record is `gate_record {runDb, stage,
scope: respond-plan, shape: respond-plan, answers: <the plan>, decidedBy}`,
plus `contextDropped: true` when the handed `--report` carries
`gate-1-context: dropped`. The rows come from the record; the thread read
(skipped when the threads are already in this conversation) supplies only
the bodies the fix and override rows need. The record needs the
respond-plan source on the run first: `respond_post_execute` refuses a run
without it, and a source stored after the decision makes it stale. The
plan is spent once recorded: go to the rows, never record it again; a
revise adjudicates afresh. A plan handed to a resumed run whose only
respond-plan record says `code-changes: revise` is not yet spent: that
record answered the earlier open, and this plan answers the open the
revise built.
