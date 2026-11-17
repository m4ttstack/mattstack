---
node: gate_ask_result
---

# gate_ask result?

**ok:** keep `id`, `paneAction`, `formContext` and `formChunks`, and on
`answered` also `answers`, `next` and `decidedBy`;
`labelsTruncated` lists labels the tool shortened, so never shorten one
yourself. **`runErrors`:** a run write failed: quote it in one line and
carry on at `paneAction?`, never re-asking the gate or writing that field
yourself. On `answered` the gate is already answered, and "Take the mode's
answer" records the run decision that did not save.
