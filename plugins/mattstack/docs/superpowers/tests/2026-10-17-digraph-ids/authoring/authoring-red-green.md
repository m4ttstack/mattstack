# Authoring RED/GREEN: short ids with the sentence as label

## Method

- Scenarios: `A1-draw.md` (draw a new graph from prose), `A2-extend.md`
  (extend a 12-node short-id graph that passes check-dot.py) and
  `A3-other-tools.md` (draw a graph unlike the skill's example: a shell
  call, a CamelCase tool, a call behind a `NAME=value` prefix, a non-push
  guard STOP).
- 5 reps per scenario per phase, each in a fresh empty dir:
  `claude --model sonnet --tools "" --strict-mcp-config --setting-sources local --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence --append-system-prompt-file <skill copy> -p "<scenario text>"`
- RED skill copy: `SKILL.md` at 1043f9eb8, byte-identical at 8ec9bbe65
  (text is the quoted id, no labels).
  GREEN skill copy: the edited `SKILL.md`.
- Scoring is mechanical: the first ```` ```dot ```` fence of each output goes
  through check-dot.py. Form is short ids (every node labelled, no id-form
  finding), sentences (no labels) or mixed ("label every node or none").
  Words are `wc -w` of the block body. Digit ids are any declared id with a
  digit.
- Pass: at least 4 of 5 per scenario give a short-id block that passes
  check-dot.py, with no mixed graph and no digit id.

## RED (base skill)

| Rep | Form | check-dot | Words | Digit ids |
| --- | --- | --- | --- | --- |
| A1-1 | sentences | ok | 176 | none |
| A1-2 | sentences | ok | 177 | none |
| A1-3 | sentences | ok | 179 | none |
| A1-4 | sentences | ok | 174 | none |
| A1-5 | sentences | ok | 168 | none |
| A2-1 | short ids | ok | 172 | none |
| A2-2 | short ids | ok | 170 | none |
| A2-3 | short ids | ok | 172 | none |
| A2-4 | short ids | ok | 170 | none |
| A2-5 | short ids | ok | 172 | none |

A1: 0 of 5 short ids. Every rep wrote the sentences as quoted ids.

A2 is a regression guard, not evidence the edit works: RED and GREEN both
copy the form they are handed. It shows the skill does not push agents back
to sentences or half-convert a graph. In RED, 5 of 5 kept the given form,
but the skill pulled against it. Two reps
said so: "I kept your opaque ids with separate labels. The skill's node
vocabulary prefers the sentence as the quoted node id, which is a separate
cleanup." and "`check-dot.py` flags opaque ids. If this skill is run
through that check, I can convert the block."

## GREEN (edited skill, first pass)

| Rep | Form | check-dot | Words | Digit ids |
| --- | --- | --- | --- | --- |
| A1-1 | short ids | ok | 113 | none |
| A1-2 | short ids | ok | 114 | none |
| A1-3 | short ids | ok | 113 | none |
| A1-4 | short ids | ok | 113 | none |
| A1-5 | short ids | ok | 114 | none |
| A2-1 | short ids | ok | 172 | none |
| A2-2 | short ids | ok | 172 | none |
| A2-3 | short ids | ok | 172 | none |
| A2-4 | short ids | ok | 170 | none |
| A2-5 | short ids | ok | 172 | none |

A1: 5 of 5 short ids passing check-dot. A2: 5 of 5. No mixed graph, no digit
id, and no rep flagged the form as conflicting with the skill. The A1 block
shrank from 168-179 words to 113-114 (about 35%).

Verdict: pass on the first round; no revision.

## Fix round 1: A3 and the env-prefix rule

GREEN A1 copied the example's ids word for word, so it could not tell
learning the rule from copying. A3 is a process unlike the example. The
skill also gained the `NAME=value` skip in the plaintext prefix rule.

### A3 RED (base skill)

| Rep | Form | check-dot | Words | Digit ids |
| --- | --- | --- | --- | --- |
| A3-1 | sentences | ok | 271 | none |
| A3-2 | sentences | ok | 242 | none |
| A3-3 | sentences | ok | 240 | none |
| A3-4 | sentences | ok | 258 | none |
| A3-5 | sentences | ok | 242 | none |

### A3 GREEN (final skill)

| Rep | Form | check-dot | Words | Digit ids |
| --- | --- | --- | --- | --- |
| A3-1 | short ids | ok | 163 | none |
| A3-2 | short ids | ok | 149 | none |
| A3-3 | short ids | ok | 154 | none |
| A3-4 | short ids | ok | 151 | none |
| A3-5 | short ids | ok | 167 | none |

Every GREEN rep wrote `gh_pr_view`, `enter_worktree`, `claude_plugin_update`
for the `CLAUDE_CONFIG_DIR=<dir>` call, and `stop_cache_edit`; none of these
ids appear in the skill. A3: 0 of 5 to 5 of 5, block words down about 37%.

### A1 GREEN rerun (final skill)

| Rep | Form | check-dot | Words | Digit ids |
| --- | --- | --- | --- | --- |
| A1-1 | short ids | ok | 113 | none |
| A1-2 | short ids | ok | 113 | none |
| A1-3 | short ids | ok | 115 | none |
| A1-4 | short ids | ok | 114 | none |
| A1-5 | short ids | ok | 113 | none |

Verdict: A3 and the A1 rerun pass on the final text; no revision round.
