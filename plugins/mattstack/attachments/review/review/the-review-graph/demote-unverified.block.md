---
node: demote_unverified
---

# Demote each unverified finding to Minor, marked unverified

Each finding that failed round two moves to Minor, its `body` prefixed
`Unverified: <the failed check>.` Readiness is never raised by a demotion;
the reasoning gains one sentence naming the demoted findings. The json,
written afterward, mirrors the demoted draft; demotion never edits an
already-written json.
