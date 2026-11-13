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
  {id, answers, runDb?, stage?}` carrying every thread answer. The pane's
  answer never carries `text`: whatever the human types, a full
  replacement reply included, rides as `note`, and the drafted reply
  posts.
- **wait:** as gate-protocol draws it; an answer from the board or console
  routes the same way, a `next` it carries included.

A paragraph that lists the replies and waits is not this gate. Neither
`gate_answer` nor `gate_reconcile` records it: `gate_record {..., gateId:
<id>}` does, before the post side, only on an answer that proceeds (no
`next`, or `proceed`; `respond_post_execute` refuses any other), and
builds the selection itself.
