---
order: 4
---

# Off-script gate

Every `Off-script gate: ...` box opens gate-protocol's `## Off-script
gate` with site `receive-review`: scope `off-script:receive-review:<n>`
(`n` from 1 within the site's attempt), `context` quoting the refusal or
failure verbatim, under the run with `runDb` and `stage`. A board that
owns the receive-review gates does not own these: they open in this pane.

The answer diamond reads it: `action: handback` is hand back whatever
`next` says; otherwise proceed takes the proposed move exactly once,
iterate redoes that site with their note, hold holds. After a take or
iterate the site's budget stays spent: the next failure returns to the
same gate. Hand back closes an own run `abandoned` or fails an inherited
run's stage, with the why as `reason` (also in the hand-back when a caller
owns the gates). A gate that comes back `closed` is a hold whose reason is
"gate closed".
