---
name: acme-scripts
description: "Evidence rules for acme-queue contrast checks, captured by script. Loaded by the evidence stage; not for direct invocation."
disable-model-invocation: true
metadata:
  provides: evidence-domain@1
---

# acme-queue script evidence

The only evidence kind is a script capture: run
`node scripts/shot.mjs <url> <out.png>` and keep the image exactly as shot.
Reviewers judge raw contrast, so the image is never edited.

At: Capture the BEFORE

Run `node scripts/shot.mjs <url> <evidence folder>/<case>-before.png` for the
case's page.

At: Gate evidence-attach

Annotations: None. Upload the image as shot.
