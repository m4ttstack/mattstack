---
node: gate_fix_and_next
kind: gate
label: Fix and next
---

# Gate self-review: fix and next, after the draft

Run gate-protocol's Runs integration with `gate_ask {questions, kind:
self-review, context, runDb, stage, reach: "worktree"}`, `context`
quoting the draft's Issues and, when the Assessment has one, its `Unanswered rules:` line, and
naming apart the findings the reviewer marked judgment calls and the
evidence only the pushed branch can show, since the fix loop records those
instead of fixing them. One question, `fix`, worded by the draft:

| Question | Options (recommended first) | Shown when |
|---|---|---|
| `fix` (write-in) | **Ship as is (Recommended)** (`none`) / **Fix every finding** (`all`) | the draft is a re-review's and holds no Critical or Important finding |
| `fix` (write-in) | **Fix every finding (Recommended)** (`all`) / **Fix the blocking findings only** (`blocking`: Critical and Important) / **Ship as is** (`none`) | any other draft |

A full review's Minor finding is cheap to fix now and costly once a
teammate raises it, so `all` leads there. A re-review has already approved
the fixes; Minors left on its draft go to ship recorded as open, rather
than buying another fix round and another re-review.

The answers map is `{fix}` at scope `self-review`. On a resume, a
recorded `self-review` decision whose `fix` is `all`, `blocking` or `none`
is reused as proceed, asking nothing. A `fix` write-in
(`{"writeIn": ...}`) resumes at gate-protocol's Act on a write-in: do what
it asks, then open a NEW self-review gate.
