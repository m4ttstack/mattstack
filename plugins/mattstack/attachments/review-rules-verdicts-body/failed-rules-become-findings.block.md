---
order: 3
---

# Failed rules become findings

Each rule with a `fail` verdict is one finding in the draft's Issues, in
the same shape as the reviewer's own. `pass` and `not-applicable` verdicts
make none.

| Part | Filled from |
|---|---|
| Title | `<rule id>: <summary>`, the summary from the selection |
| Tier | `blocking` rule: Important. `advisory` rule: Minor. A rule never assigns Critical |
| Anchor | the first evidence entry on the `new` side (an entry with no `side` is `new`) |
| Body | the verdict's note, and every `old`-side location as `file:line (old side)` |

A fail whose evidence is all on the `old` side, or absent, has no anchor:
it stays a finding, with its locations in the body.

A fail at the same file and line as a finding the reviewer reported merges
into one finding. It carries both bodies, the rule's title and the higher
of the two tiers.
