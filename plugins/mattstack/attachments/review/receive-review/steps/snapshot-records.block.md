---
node: snapshot_records
---

# What does the receive-review snapshot record?

The resumed run's decisions pick the re-entry; a question they answered is
never asked again.

- **No `respond-plan` record:** nothing is decided; go on as a fresh run.
- **`respond-plan` recorded, no `respond-post` record:** rewrite the
  report rows from the recorded decision joined to the stored cards (the
  `run_field_get` of `extra.gate-source.respond-plan`), then walk the
  rows. Never record respond-plan again: a second record moves its
  `decided_at`, which `respond_post_execute` reads for the decision's
  freshness and for which notes by this account count as already posted.
- **`respond-plan` recorded with `code-changes: revise`, no
  `respond-post` record, nothing handed, and the snapshot's
  `extra.gate-source.respond-plan` field `at` later than that decision's
  `decided_at`:** the revise already re-adjudicated and opened the next
  round, which nobody has answered. Re-present that pending round from its
  stored source (`Write the pending round's source for gate_open`): no
  dispatch, no record, and nothing implemented or posted until a fresh
  answer to it. With the source stored at or before the revise, the revise
  never ran: the previous bullet's rows lead to its fresh dispatch, with
  the revise's `notes` entry for `code-changes` as the note.
- **`respond-plan` recorded with `code-changes: revise`, no
  `respond-post` record, and the caller handed a `{plan}`:** the revise
  re-adjudicated and stored a new respond-plan source, and the handed plan
  answers that newer open. Take it through `What did the caller hand
  receive-review?` as an unspent plan: it records once against the stored
  cards. The revise record never acts (`respond_post_execute` refuses
  it), so rows rebuilt from it drop the human's newer answer.
- **The same, and the caller handed a `{post}`:** record it at once
  (`answers`, `decidedBy`), then the post side; the rows walk nothing.
- **A `respond-post` record, held or not:** the post side again, never a
  close on the record alone: a pane can record and die before it posts.
  On GitLab `respond_post_execute` counts what landed. On GitHub the gh
  read does, and the reply texts come from the stored cards, never this
  conversation: for a `gate-1: reply` row the
  respond-plan decision's `texts` entry, else its card's `reply.text`; for
  an offered thread the respond-post decision's `text`, else its `reply@1`
  card's `text` (`run_field_get {runDb, key:
  extra.gate-source.respond-post}`).
