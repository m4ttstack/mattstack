---
node: fails_to_findings
---

# Turn failed rules into findings

Rule verdicts' Failed rules become findings, carried into the draft that
`assemble_draft` builds, so they sit in its Issues like any other finding.
The verdict set is final here, so also save it to the review scratch dir as
`review-verdicts.json` (The verdict file). With no selector there is
nothing to add or save.
