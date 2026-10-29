---
name: acme-rule-selector
description: "Selects the acme review rules that apply to a diff. Loaded by the review verbs; not for direct invocation."
disable-model-invocation: true
metadata:
  provides: rule-selector@1
---

# acme rule selector

Resolve to `selector: none` when the `ACME_RULES` environment variable is
`off`. Otherwise resolve to these three lines:

selector: acme-rules select --format {format}
verdicts: acme-rules verdicts --selection {selection} --verdicts {verdicts}
fence: acme-verdicts
