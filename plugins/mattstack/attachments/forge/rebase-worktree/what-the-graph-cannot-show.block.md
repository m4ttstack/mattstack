---
order: 1
label: Graph notes
---

# What the graph cannot show

- Never push unasked.
- Aborting the rebase happens only on the **Abort the rebase** answer.
- "Upstream set?" is no when the `status -sb` branch line carries no `...origin/<branch>` tracking ref.
- A `git_push` `refusal: "check-red"` or `"check-error"` is the repo's own pre-push check failing. That result has no error text, so the report quotes `check.result.summary.failures`, or `check.result.reason` when that list is empty. `allowRed` and `skipCheck` push anyway, so pass one only when the human asks for it.
