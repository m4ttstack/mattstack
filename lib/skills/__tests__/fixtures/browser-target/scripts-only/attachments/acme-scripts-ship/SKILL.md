---
name: acme-scripts-ship
description: "Ship rules for acme-queue contrast checks, captured by script. Loaded by the ship stage and door; not for direct invocation."
disable-model-invocation: true
metadata:
  provides: ship-domain@1
---

# acme-queue script ship

At: Preflight

Run `bun run lint` before the push.

At: Capture the AFTER when the domain names one

Run `node scripts/shot.mjs <url> <evidence folder>/<case>-after.png` for the
case's page and keep the image exactly as shot.
