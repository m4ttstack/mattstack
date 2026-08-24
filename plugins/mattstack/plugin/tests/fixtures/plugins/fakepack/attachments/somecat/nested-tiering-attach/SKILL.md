---
name: nested-tiering-attach
description: "Test fixture plugin skill providing tiering@1 from a category dir under attachments/, not skills/. Never invoked by a model."
disable-model-invocation: true
metadata:
  provides: "tiering@1"
---

# fakepack nested-tiering-attach

Fixture only: lives one category level below attachments/, the shape an
engine takes once it moves out of skills/.
