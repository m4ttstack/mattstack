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

Floor: ok in all three. These reps are superseded as committed outputs by
the post-fix run (last section).

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

## Conversational (three reps)

Floor: ok in all three. These reps are superseded as committed outputs by
the post-fix run (last section).

| Fixture | Words (r1 / r2 / r3) | Observation |
| --- | --- | --- |
| 1-review | 103 / 143 / 100 | sentence case; bold labels; repro as an output block; ask as a friendly question with the fix fenced; missing tests its own comment; one-line summary that points at the blocker (r3: "One blocker inline (the cache key), otherwise looks good to me."). r2 split the eviction fix into a second inline finding with a fenced function |
| 2-replies | 30 / 30 / 32 | `Good call, switched to Record<Status, string>.`; gentle disagreement with the reason, no thanks |
| 3a-pr | 129 / 138 / 127 | sentence-case ticket title, three-sentence framing that says where to start, What changed and Testing, follow-up as a sentence under What changed; a little under the companion's 150 |
| 3b-pr-with-template | 159 / 180 / 161 | Summary, Checklist, Verification kept in all three |
| 4-commit | 38 / 35 / 36 | `ABC-481: Key the settings cache on tenant and user` (sentence case, 49 chars) plus a two-sentence why |

r1 and r3 invert the fixture's fact: they say user ids "only repeat within
(or per) a tenant" where the fixture says they are unique within one; r1
carries it in four of five files. Only r2 states it correctly. The runs do
not show the style causing the slip, and they do not rule it out. Every
plan check holds; no REFACTOR.

## Structured (three reps)

Floor: ok in all three. These reps are superseded as committed outputs by
the post-fix run (last section).

| Fixture | Words (r1 / r2 / r3) | Observation |
| --- | --- | --- |
| 1-review | 102 / 103 / 89 | label line carries the problem, then Why, Impact (with the repro as an output block), Suggestion, and the fix fenced; nitpick is the label and one line; missing tests its own comment; summary `One blocker inline (cache key).` |
| 2-replies | 24 / 25 / 25 | outcome first: `Changed to Record<Status, string>.` and `Keeping it sync: ...` with one reason |
| 3a-pr | 118 / 116 / 112 | Summary, Changes, Testing, Follow-up in all three; under the companion's 200 because the change is small |
| 3b-pr-with-template | 142 / 144 / 138 | Summary, Checklist, Verification kept in all three |
| 4-commit | 44 / 46 / 41 | `ABC-481: Key the settings cache on tenant and user` plus a three-line why |

Every plan check holds; no REFACTOR.

## Auto-trigger check

A roster of every compiled skill's name and description, the task "Draft
my review comments for PR #212 in acme/storefront and post them.", and
NONE allowed: 10 of 10 picks (5 haiku, 5 sonnet) were NONE, each citing the
lookup gate. No preset loads unless the lookup names it.

## After the final-review fixes (two reps per preset)

The fixes: one finding per comment and a single proposed name or type may
stay inline (floor); the PR title goes in the title field; conversational
and structured lengths become ceilings. The committed `outputs/<preset>/`
for all three presets is f1 from this run.

| Preset | Floor | 1-review | 2-replies | 3a-pr | 3b-pr | 4-commit |
| --- | --- | --- | --- | --- | --- | --- |
| sparse | ok / ok | 94 / 89 | 35 / 31 | 105 / 107 | 135 / 141 | 31 / 32 |
| conversational | ok / ok | 104 / 103 | 30 / 30 | 112 / 116 | 146 / 146 | 33 / 30 |
| structured | ok / ok | 102 / 93 | 26 / 24 | 117 / 115 | 141 / 139 | 39 / 35 |

Every earlier check holds in all six: labels, repro as an output block,
the fix fenced, one finding per comment, missing tests its own comment,
one-line summary, template sections kept in 3b. All six state the tenant
fact correctly ("unique within a tenant" or "repeat across tenants").
Each PR output still opens with the title line, because the fixture asks
for one file holding everything posted.
