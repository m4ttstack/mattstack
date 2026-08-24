---
name: tiering-attach
description: "Test fixture plugin skill providing tiering@1 from the plugin's attachments/ root, not skills/. Never invoked by a model."
disable-model-invocation: true
metadata:
  provides: "tiering@1"
---

# fakepack tiering-attach

Fixture only: lives under attachments/, not skills/ or a skills/<category>/ dir.
