---
node: fails_to_findings
---

# Turn failed rules into findings

Rule verdicts' Failed rules become findings, added to the assembled draft
before verification, so the verify and demote steps treat them like any
other finding. With no selector there is nothing to add. After
`redispatch_reviewer` the draft is assembled again and the merge keeps one
finding per rule.
