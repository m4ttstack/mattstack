---
node: fails_to_findings
---

# Turn failed rules into findings

Rule verdicts' Failed rules become findings, added to the assembled draft
before verification, so the verify and demote steps treat them like any
other finding. The verdict set is final here, so also save it to the review
scratch dir as `review-verdicts.json` (The verdict file). With no selector
there is nothing to add or save. After
`redispatch_reviewer` the draft is assembled again and the merge keeps one
finding per rule.
