---
name: acme-review-criteria
description: "Review standards for the acme-queue app: where requirements come from and what each review depth runs. Loaded by the review verbs; not for direct invocation."
disable-model-invocation: true
metadata:
  provides: review-criteria@1
---

# acme-queue review criteria

## Requirements

The linked ticket's acceptance criteria. The MR description stands in only
when no ticket exists.

## What each depth runs

- **verify** -- `bun run lint` and `bun run test` in the checkout.
- **repro** -- additionally capture the change as the browser target
  section of `{{pack.path:acme-evidence/SKILL.md}}` says, and compare it
  with the MR's attached before and after.
