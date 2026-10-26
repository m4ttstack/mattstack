---
node: decide_nothing
---

# Decide nothing at respond-post: no push, post, resolve or record

A `hold` or `iterate` answer decides nothing, whatever its thread picks
say: nothing pushes, posts or resolves, and no respond-post decision is
recorded (no `gate_record`, no `respond_post_execute`), so every offered
thread stays pending and the `gate-1: reply` rows keep waiting. The gate
is still answered with its `next` (one `gate_answer`, unlike respond-plan's
pane-only `next`), so it closes. A `hold` ends the turn through
`run_hold`; that is not a respond-post decision.
