---
node: plan_open_result
---

# respond-plan gate_open result?

- **Opened** (the direct run): keep `id`, `paneAction`, `formContext`,
  `formChunks` and `contextDropped`. The run stores the untrimmed source
  as `extra.gate-source.respond-plan`, the cards `gate_record` and a
  resumed pane read.
- **Handed back, no unspent plan:** the open is at `outPath` in
  `gate-ctx.sh fit`'s shape, its source beside it, and the run stores the
  source. Keep `contextDropped` and `droppedContexts`.
- **Handed back, an unspent handed plan:** the source is stored (`gate:
  null`) and nothing goes to the caller. Record the plan, with
  `contextDropped: true` when this result or the handed `--report` says
  so.
- **Refused:** nothing opened, one problem per line. A line naming a
  question or a source field is fixable; a refusal no source fix can mend
  (an unreadable file, a path outside the read roots) goes straight to the
  off-script gate.

Only `gate_open` fits the open: a hand-edited open, a shortened reply or a
fit with the vendored script is this diamond's STOP.
