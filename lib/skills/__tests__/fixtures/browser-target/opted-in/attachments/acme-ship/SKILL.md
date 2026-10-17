---
name: acme-ship
description: "Ship rules for the acme-queue app: MR preflight and description shape. Loaded by the ship stage and door; not for direct invocation."
disable-model-invocation: true
metadata:
  provides: ship-domain@1
---

# acme-queue ship

At: Preflight

Run `bun run lint` and `bun run test`. Both must pass before the push.

At: Description

Title is `<ticket>: <summary>`. The body has What and Verification sections;
the evidence shows under Verification.

At: Capture the AFTER when the domain names one

Browser screenshots use the browser target section of `{{pack.path:acme-evidence/SKILL.md}}`.
