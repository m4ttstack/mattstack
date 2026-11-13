---
node: gate_post_carry
kind: gate
label: Review post
---

# Gate review-post: carry the opened gate through gate-protocol

Enter gate-protocol at `Trigger: a site opened its gate with gate_open`
with the result and walk on from `paneAction?`. On a review gate neither
`gate_answer` nor `gate_reconcile` records: keep the gate's `id` and
answers map for Compose; the `gate_record` after posting is the record.
review-post is answered on the board only: its `paneAction` is always
`wait`, so this pane never presents a form for it. Wait as gate-protocol
draws it (the doorbell, then reconcile); the board's answer routes as
`Review-post next answer?` draws. `contextDropped: true` changes nothing
here: it names the pane form, and the gate stores every context whole.

A `next` of `iterate` or `hold` routes as `Review-post next answer?`
draws, but only a hand-back or a future surface can send one: the daemon
refuses an answer key the gate did not ask.
