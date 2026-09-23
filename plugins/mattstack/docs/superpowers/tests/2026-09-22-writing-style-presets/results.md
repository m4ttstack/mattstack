# Results

Runs per `protocol.md` (clean mode, most capable model). Word counts are
`wc -w` of the whole output file.

## Baseline (no style)

Floor: FAIL (one em dash, `3b-pr-with-template.md:13`).

| Fixture | Words | Floor | Observation |
| --- | --- | --- | --- |
| 1-review | 205 | ok | no Conventional Comments labels; the fix `${tenantId}:${userId}` sits inline in prose; the eviction finding restates the main one; the summary is four sentences that recap the finding and report the repro |
| 2-replies | 65 | ok | opens "Agreed,"; the disagreement adds a second argument ("If a remote source shows up...") |
| 3a-pr | 156 | ok | `##` headings (Changes, Testing, Not in this PR); bullets carry "so ..." why clauses |
| 3b-pr-with-template | 191 | FAIL | keeps the template's three sections; em dash in the checklist line |
| 4-commit | 56 | ok | ticket key trails the body instead of prefixing the subject; two body paragraphs restate the subject |

Failures the presets must fix:

- em or en dashes
- findings with no Conventional Comments label
- code for a fix inline in prose instead of a fenced block
- a review summary that recaps a finding or reports what was run
- an agreement opener on a reply ("Agreed,")
- a second supporting argument after the one reason
- why clauses riding on PR bullets
- commit subject without the ticket prefix, and a body that restates it

## Reference (the operator's own style skill)

Floor: ok.

| Fixture | Words | Floor | Observation |
| --- | --- | --- | --- |
| 1-review | 100 | ok | bold `**issue:**`, lowercase, repro as an output block, ask as a question with the eviction fix folded in; logger a one-line `**nitpick:**`; missing tests its own `**suggestion:**` comment; one-line summary |
| 2-replies | 31 | ok | `good call.` on the concession; disagreement hedged ("i think i'd keep it sync"), one reason |
| 3a-pr | 122 | ok | ticket title, one framing sentence pair, bold groups (Cache, Wiring, Also), Follow-up, one-sentence verification with the specific case |
| 3b-pr-with-template | 140 | ok | template's Summary, Checklist, Verification kept; groups nested under Summary |
| 4-commit | 33 | ok | `ABC-481:` lowercase subject, two lowercase body lines |

The fix for the main finding is short enough (`${tenantId}:${userId}`) that
the reference keeps it inline; the floor's fenced-block rule targets more
than a few tokens of code.
