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

## Sparse, run 1

Floor: ok.

| Fixture | Words | Floor | Observation |
| --- | --- | --- | --- |
| 1-review | 85 | ok | same labels as the reference (issue, nitpick, suggestion), lowercase, three sentences, ask as a question, fix in words (no code inline); missing tests its own comment; one-line summary. Miss: the reproduced result is a clause in prose, where the reference pastes it as an output block |
| 2-replies | 29 | ok | `good call.` on the concession only; disagreement softened ("probably"), one reason |
| 3a-pr | 101 | ok | 83% of the reference's 122; ticket title, one framing sentence, bold groups (Cache, Callers), Follow-up, one-sentence verification with the t2/u7 case |
| 3b-pr-with-template | 131 | ok | template's Summary, Checklist, Verification kept |
| 4-commit | 31 | ok | `ABC-481: key settings cache on tenant and user` (46 chars), two lowercase body lines |

Loophole: the floor's evidence rule has no example, and the finding folded
the repro into a sentence. REFACTOR: give the rule a short output example.

## Sparse, after the evidence example (three reps)

Floor: ok in all three.

| Fixture | Words (r1 / r2 / r3) | Observation |
| --- | --- | --- |
| 1-review | 72 / 76 / 74 | repro pasted as an output block in all three; same labels and one-line summary. Miss in r2 and r3: the fix `${tenantId}:${userId}` inline in the ask |
| 2-replies | 29 / 29 / 29 | stable: `good call.` then a hedged one-reason disagreement |
| 3a-pr | 108 / 92 / 111 | 75% to 91% of the reference; same shape |
| 3b-pr-with-template | 131 / 116 / 141 | template sections kept in all three |
| 4-commit | 31 / 32 / 28 | `ABC-481:` lowercase subject in all three |

Loophole: "more than a few tokens of code" let a one-line key slip inline.
REFACTOR: suggested code is always fenced; backticks only for names that
already exist.

Fixture 2 and fixture 1's test ask overlap the preset's own reply and
process-ask examples (as they overlap the reference skill's), so those two
rows measure example-following more than generalization.

## Sparse, after fencing suggested code (three reps)

Floor: ok in all three. 1-review 73 / 79 / 77 words; 3a 86 / 102 / 98
(70% to 84% of the reference). The fix lands in a fenced block in all
three, the repro stays an output block in all three, and every other row
holds. One rep separated top-level comments with `---` rules.

## Sparse, final (examples no longer mirror the fixtures; three reps)

Floor: ok in all three. The committed `outputs/sparse/` is r1.

| Fixture | Words (r1 / r2 / r3) | Observation |
| --- | --- | --- |
| 1-review | 74 / 97 / 84 | `**issue:**`, `**nitpick:**`, `**suggestion:**` as in the reference; lowercase; repro as an output block and the fix in a fenced block in all three; missing tests its own comment; summary `Left one blocker inline.` The process ask drops the approval lead, correctly, since there is a blocker |
| 2-replies | 30 / 27 / 28 | `good call.` on the concession; disagreement softened ("for now", "i think") with one reason; worded independently, no longer copied from an example |
| 3a-pr | 105 / 102 / 94 | 77% to 86% of the reference; ticket title, one framing sentence, bold groups, Also, Follow-up, one verification sentence with the t2/u7 case |
| 3b-pr-with-template | 135 / 132 / 125 | Summary, Checklist, Verification kept in all three |
| 4-commit | 32 / 30 / 31 | `ABC-481: key settings cache on tenant and user` (46 chars) in all three; two lowercase body lines |

Verdict: sparse lands on the reference's labels, length and shape. It is
stricter than the reference on one point by design: the fix goes in a
fenced block where the reference kept a short key inline.
