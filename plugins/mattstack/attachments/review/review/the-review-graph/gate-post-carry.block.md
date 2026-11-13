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

The pane form answers as the board's review sheet does. An unticked
finding does not post; a ticked `restore:<id>` brings a skipped one back.
On `editable` extras, text the human types for a ticked finding replaces
its drafted comment, sent as that `findings-<n>` answer's `texts`
(`{"value": [<ticks>], "texts": {"<finding id>": "<text>"}}`), and text
for the summary replaces the picked verdict's line as the `outcome`
answer's `text`. Text on a `thread-<n>` that posts replaces its reply as
that answer's `text`. Each goes only when it differs from the draft,
never empty; any other words ride as the `outcome` answer's `note`,
which never changes posted text.

A `next` of `iterate` or `hold` routes as `Review-post next answer?`
draws, but only a hand-back or a future surface can send one: the daemon
refuses an answer key the gate did not ask.
