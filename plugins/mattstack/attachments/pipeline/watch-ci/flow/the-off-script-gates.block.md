---
---

# The off-script gates (watch-ci)

Each off-script gate in this flow is the gate protocol's Off-script gate (scope
`off-script:<stage>:<n>`, `context` quoting the refusal), with `action`
**Take** (the move its section names) / **Hand back**, and `next`
**Proceed** (Recommended) / **Iterate here** (the human fixed it) /
**Hold**. A spent Iterate budget fails, quoting the refusals.

The `lease_unavailable` and `git_push` gates have no budget: `ci_watch`
re-claims itself, a `git_push` retry needs a new answer, a refusal reopens
the gate. An attending Take closes an own run `done`, the report saying so;
an inherited run hands the answer back.
