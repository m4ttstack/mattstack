# RED/GREEN: watch-ci short digraph ids

Do fresh agents follow watch-ci's two dot graphs as well with short node ids
(`git_push [label="git_push {tree}"]`) as with sentence ids
(`"git_push {tree}"`)? Node text, shapes and edges are the same on both
sides. Only the id form differs.

## Method

- **RED** is the sentence-id SKILL.md at `1043f9eb8`, which is the same file
  as at `b4bda00f6`. **GREEN** is the short-id SKILL.md at HEAD, converted
  with `convert.py --scheme all` and `slugs/watch-ci.json`.
- **Prompt** (`run-reps.sh` input): the side's SKILL.md, uncompiled, then the
  World, Conventions, Shared shapes and `## watch-ci` sections of
  `../2026-10-16-ship-ci-skills/scenarios.md` (up to the line before
  `## stage-watch-ci`, so `## Triage (acme/app)` is included), then: "Follow
  this skill exactly. For each scenario, list every tool call or shell
  command you would make, in order, with its arguments, and where you stop
  and why. You cannot execute anything." Both sides get the same scenarios
  and wording. Each rep covers 13 scenarios: T1 to T10, T3b, W1 and S6.
- **Recipe**: the ship-ci lane's recipe, run by `run-reps.sh` from a fresh
  empty directory per rep, with at most 5 reps running at once. The prompt is
  passed as `-p -- "$(cat <file>)"`. The `--` matters: without it the CLI
  read the prompt's leading `---` frontmatter line as an unknown option. The
  first launch of all 10 reps failed that way, with empty output, and was
  rerun once after the fix.
- **Probe**: one rep was asked to run `echo probe-ok` with Bash. It ran no
  tool. One run returned `The model's tool call could not be parsed`. The
  other printed a made-up tool block in its text. Its rep directory stayed
  empty, so nothing was executed.
- **Reps**: 5 RED and 5 GREEN.
- **Blinding**: `blind.sh` copied the 10 transcripts to random names. Every
  transcript was scored in `blind.sh`'s shuffled order, and the mapping was
  read only afterwards. The only slug ids GREEN reps quoted are ids that are
  also tool names (`ci_watch`, `mr_retry`, `run_enter`, and so on), and RED
  reps quote those just as often. No GREEN-only id (for example
  `stop_lease_holder_owns`) appeared, so in practice the blind held.
- **Scoring**: each scenario of each rep is scored against its
  `../2026-10-16-ship-ci-skills/expected.md` entry, on the lane's eight
  columns plus "stop named". A move counts as a deviation only when
  expected.md calls it wrong or names the step as required. Wording
  differences never count.
- **Stop named** is yes when the rep's stop names the node it stops at, by
  its text or its id. That node is a STOP octagon, the stand-down, or the
  closing `run_close` / done exit. Close paraphrases count ("the lease
  holder owns every repair", "stand down and report the holder"). A bare
  "Stop." does not count, and neither does a STOP named only by its effect
  ("no shell push") or by "the STOP edge" alone.
- **Pass bar**: GREEN's total deviations are at most RED's, for the skill as
  a whole and for every scenario.

## Results

### RED

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | stop named | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no | says the STOP edge without its text |
| T4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no | names the off-script gate, not the STOP |
| T4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T4 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no | bare I stop, no node named |
| T5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no | bare Stop, no node named |
| T6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |

### GREEN

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | stop named | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T3b | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no | stop paraphrased as no shell push |
| T4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no | stop paraphrased as no shell push |
| T4 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| W1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T7 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T8 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T9 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |

### Totals per scenario

| scenario | RED deviations | GREEN deviations | RED stop named | GREEN stop named | GREEN <= RED |
|---|---|---|---|---|---|
| T1 | 0 | 0 | 5/5 | 5/5 | yes |
| T2 | 0 | 0 | 5/5 | 5/5 | yes |
| T3 | 0 | 0 | 5/5 | 5/5 | yes |
| T3b | 0 | 0 | 5/5 | 5/5 | yes |
| T4 | 0 | 0 | 3/5 | 3/5 | yes |
| T5 | 0 | 0 | 3/5 | 5/5 | yes |
| T6 | 0 | 0 | 5/5 | 5/5 | yes |
| W1 | 0 | 0 | 5/5 | 5/5 | yes |
| T7 | 0 | 0 | 5/5 | 5/5 | yes |
| T8 | 0 | 0 | 5/5 | 5/5 | yes |
| T9 | 0 | 0 | 5/5 | 5/5 | yes |
| T10 | 0 | 0 | 5/5 | 5/5 | yes |
| S6 | 0 | 0 | 5/5 | 5/5 | yes |
| total | 0 | 0 | 61/65 | 63/65 | yes |

### Totals per column

| column | RED | GREEN |
|---|---|---|
| shell calls a tool covers | 0 | 0 |
| hand-held lease calls | 0 | 0 |
| counters in context | 0 | 0 |
| re-derived values | 0 | 0 |
| skipped steps | 0 | 0 |
| runaway loops | 0 | 0 |
| refusal missed its gate or stand-down | 0 | 0 |
| release on a stand-down | 0 | 0 |
## Verdict

**Pass.** Both sides scored 0 deviations, so GREEN is at most RED in total
and in 13 of 13 scenarios. No fix round was needed, and the slug map and
SKILL.md are unchanged.

**Stop named**: GREEN 63/65, RED 61/65. Every miss is on one of the two
non-lease STOP stops:

- **T4**: two reps per side paraphrased `STOP: push only with git_push` as
  "no shell push" or "the STOP edge".
- **T5**: two RED reps wrote a bare "Stop." at the lease-held refusal.

That 2-rep gap in T5 is noise: it is the same paraphrase habit, not a
difference in which node the reps reached. Every rep on both sides reached
the right node.

As expected, the RED here (today's skill) behaves like the ship-ci lane's
GREEN round 3. At this sample size the measurement can show that short ids
cost nothing. It cannot show that they help.
