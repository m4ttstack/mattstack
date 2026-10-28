---
node: fails_to_findings
---

# Turn failed rules into findings

Rule verdicts' Failed rules become findings, added to the assembled draft
before verification, so the verify and demote steps treat them like any
other finding. The verdict set is final here, so also save it to the review
scratch dir as `review-verdicts.json` (The verdict file). With no selection
there is nothing to add or save; the empty selection adds nothing and saves
`{"verdicts": []}`.

On the pass after `redispatch_reviewer`, the verdict set is the one already
checked and saved: nothing is checked or saved again, and nothing is added
from it again. A rule finding the re-dispatch answered takes that answer
(confirmed, re-anchored or withdrawn), and one round one verified stays as
it was.
