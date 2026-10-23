---
node: gate_fix_and_next
---

# Gate self-review: fix and next, after the draft

Run gate-protocol's Runs integration with `gate_ask {questions, kind:
self-review, context, runDb, stage}`, `context` quoting the draft's
Issues, and two questions, each its own:

- `fix` (write-in): **Fix the blocking findings now** (`blocking`: Critical
  and Important; recommended when any exists) / **Fix the minors too**
  (`all`) / **Ship as is** (`none`)
- `next`: **Proceed** (`proceed`, recommended) / **Iterate here**
  (`iterate`) / **Hold** (`hold`) / **Abandon** (`abandon`)

The answers map is `{fix, next}` at scope `self-review`. On a resume, a
recorded `self-review` decision whose `fix` is `blocking`, `all` or `none`
is reused with `next` as proceed, asking nothing. A `fix` write-in
(`{"writeIn": ...}`) resumes at gate-protocol's Act on a write-in: do what
it asks, then open a NEW self-review gate.
