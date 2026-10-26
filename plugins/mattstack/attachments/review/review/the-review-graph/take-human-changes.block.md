---
node: take_human_changes
---

# Take the human's changes into the review draft

Apply their text to the draft. Asking for another depth goes back to the
depth block under a fresh
`verify-rounds:<depth>` key, since new setup means a fresh verify.
Anything else is a draft edit: re-present, and the next gate is a NEW
gate.
