---
node: gate_post_carry
kind: gate
label: Respond post
---

# Gate respond-post: carry the opened gate through gate-protocol

**Otherwise** the verb runs the gate itself, entering gate-protocol at
`Trigger: a site opened its gate with gate_open` and walking on from
`paneAction?`; a gate is never asked or answered from the shell.

- **form:** `### Present the in-pane gate form`. Then ONE `gate_answer
  {id, answers, runDb?, stage?}` carrying every thread answer, as the
  board's sheet sends it. A thread with `post` unticked posts nothing:
  that is how a reply is held. Text the human types on a thread that
  posts replaces its drafted reply: send it trimmed as that answer's
  `text` (`{"value": [<ticks>], "text": "<their reply>"}`), only when it
  differs from the draft, never empty, and that text is what posts.
- **wait:** as gate-protocol draws it; an answer from the board or console
  routes the same way.

A `next` of `hold` or `iterate` routes as `respond-post next answer?`
draws, but only a hand-back or a future surface can send one: the daemon
refuses an answer key the gate did not ask.

A paragraph that lists the replies and waits is not this gate. Neither
`gate_answer` nor `gate_reconcile` records it: `gate_record {..., gateId:
<id>}` does, before the post side, only on an answer that proceeds (no
`next`, or `proceed`; `respond_post_execute` refuses any other), and
builds the selection itself.
