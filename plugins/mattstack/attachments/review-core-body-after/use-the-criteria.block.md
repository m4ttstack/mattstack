---
order: 1
---

# Use the criteria

The criteria above carry the domain's review standards when the pack
binds them; none there means no triage lines and no addendum. Evaluate
each triage line they declare (`NAME: <values> -- <observable
predicate>`) and print the resolved line in the block. Their addendum goes
to the dispatch with two placeholders filled -- `{TRIAGE_FLAGS}` (those values),
`{SETUP_OBSERVATIONS}` (the setup observations, or `none`) -- everything else
verbatim.
