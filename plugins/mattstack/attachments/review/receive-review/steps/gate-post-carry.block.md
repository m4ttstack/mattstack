---
node: gate_post_carry
kind: gate
label: Respond post
---

# Gate respond-post: carry the opened gate through gate-protocol

**Otherwise** the verb runs the gate itself, entering gate-protocol at
`Trigger: a site opened its gate with gate_open` and walking on from
`paneAction?`; a gate is never asked or answered from the shell.
respond-post is answered on the board only: its `paneAction` is always
`wait`, so this pane never presents a form for it. Wait as gate-protocol
draws it (the doorbell, then reconcile); the board's answer routes as
`respond-post next answer?` draws.

A `next` of `hold` or `iterate` routes as `respond-post next answer?`
draws, but only a hand-back or a future surface can send one: the daemon
refuses an answer key the gate did not ask.

A paragraph that lists the replies and waits is not this gate. Neither
`gate_answer` nor `gate_reconcile` records it: `gate_record {..., gateId:
<id>}` does, before the post side, only on an answer that proceeds (no
`next`, or `proceed`; `respond_post_execute` refuses any other), and
builds the selection itself.
