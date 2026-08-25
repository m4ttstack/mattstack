---
name: test-runtime-native
description: A skill with runtime-native slots but compile-time placeholders (should fail)
metadata:
  slots: "x"
---

This skill uses {{slot:x}} at runtime.
