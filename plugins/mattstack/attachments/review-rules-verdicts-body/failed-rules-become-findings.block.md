---
order: 3
---

# Failed rules become findings

Each rule in the selection's `rules` or `alsoInScope` whose verdict is
`fail`, and whose verdict no leftover problem names, is one finding in the
draft's Issues, in the same shape as the reviewer's own. `pass` and
`not-applicable` verdicts make none, and so does a verdict for a rule id
in neither list. A leftover problem that names no rule leaves the whole
set unvalidated, and then no verdict makes a finding.

| Part | Filled from |
|---|---|
| Title | `<rule id>: <summary>`, the summary from the rule's entry in the selection |
| Tier | From the `severity` of that entry. `blocking` rule: Important. `advisory` rule: Minor. A rule never assigns Critical |
| Anchor | the first evidence entry on the `new` side (an entry with no `side` is `new`) |
| Body | the verdict's note, and every `old`-side location as `file:line (old side)` |

A fail whose evidence is all on the `old` side, or absent, has no anchor:
it stays a finding, with its locations in the body.

A fail merges with a finding the reviewer reported only when that finding
sits at the anchor's file and line and describes the same issue the rule
names. The merged finding carries both bodies, the rule's title and the
higher of the two tiers. Any other reviewer finding stays as its own
finding beside the rule's.
