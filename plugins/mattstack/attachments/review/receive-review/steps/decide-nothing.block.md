---
node: decide_nothing
---

# Decide nothing at respond-post: no push, post, resolve or record

A `next` of `hold` or `iterate` (only a hand-back or a future surface
sends one: the daemon refuses an answer key the gate did not ask) decides
nothing, whatever its thread picks say: nothing pushes, posts or
resolves, and no respond-post decision is recorded (no `gate_record`, no
`respond_post_execute`), so every offered thread stays pending and the `gate-1: reply` rows keep waiting. That
answer already closed the gate. A `hold` ends the turn through
`run_hold`; that is not a respond-post decision.
