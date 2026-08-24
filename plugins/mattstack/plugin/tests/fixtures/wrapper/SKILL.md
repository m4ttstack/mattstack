---
name: fixture:wrapper
description: "Test fixture wrapper for the resolve-args.sh matrix. Never invoked by a model."
disable-model-invocation: true
metadata:
  slots: "tiering, evidence"
  slot-tiering: "required tiering@1 -- names a model tier for a unit of work"
  slot-evidence: "optional evidence-capture@2 -- captures before/after evidence"
---

# fixture wrapper

Fixture only; exercised by plugin/tests/test-resolve-args.sh.
