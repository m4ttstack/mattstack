---
order: 3
---

# When the selector fails

Any of these is a setup observation, quoted as it happened:

- either selector run exits non-zero (its exit status and stderr)
- the `json` run prints text that is not JSON, or JSON with no `rules` list
- the fill resolves to neither shape (the fill text)

Then the review goes on with no selection: no rule text in the dispatch,
no verdict request, no later rule step. A selector failure never blocks a
review and never opens a gate.
