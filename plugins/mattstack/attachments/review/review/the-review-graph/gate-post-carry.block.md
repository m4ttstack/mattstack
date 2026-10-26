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
`contextDropped: true` means only the pane form left some context out;
the gate stores every context whole and stays open as it is: carry on.
