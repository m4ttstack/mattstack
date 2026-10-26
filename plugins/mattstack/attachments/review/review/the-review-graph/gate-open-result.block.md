---
node: gate_open_result
---

# gate_open result?

- **Opened** (direct): keep `id`, `paneAction` and `formChunks`; the tool
  wrote `gate` and stored the source as `extra.gate-source.post`.
- **Handed back:** nothing opened; the open is at `outPath` in
  `gate-ctx.sh fit`'s shape, its source beside it, `droppedContexts`
  naming any context the pane form left out for its budget.
- **Refused:** nothing opened, one problem per line. A line naming a field
  in the extras or the report json is a field to fix; a refusal no field
  fix can mend (a file it cannot read or parse, a path outside the read
  roots) goes straight to the off-script gate.
