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
  read only afterwards. The blind was only partial. Most slug ids that GREEN
  reps quote are also tool names (`ci_watch`, `mr_retry`, `run_enter`), and
  RED reps quote those just as often. But "shell push" never appears in RED
  reps and appears 5 times across 3 GREEN reps. It is GREEN's
  `stop_shell_push` slug written as prose, so it gave the side away. It did
  not help GREEN. The first scoring pass marked two of those T4 cells "no"
  for paraphrasing, and fix round 1 rescored them as naming the id.
- **Scoring**: each scenario of each rep is scored against its
  `../2026-10-16-ship-ci-skills/expected.md` entry, on the lane's eight
  columns plus "stop named". A move counts as a deviation only when
  expected.md calls it wrong or names the step as required. Wording
  differences never count.
- **Stop named** is yes when the rep's stop names the node it stops at, by
  its text or its id. That node is a STOP octagon, the stand-down, or the
  closing `run_close` / done exit.
  - **Text**: close paraphrases of the label count ("the lease holder owns
    every repair", "stand down and report the holder").
  - **Id**: GREEN's slug counts when written as prose. "No shell push" names
    `stop_shell_push` and counts. RED has no ids, so only its text can
    count.
  - **Not counted**: a bare "Stop.", or a reference that matches neither the
    text nor the id ("the STOP edge", or only the off-script gate's name).
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
| T4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no shell push names the id stop_shell_push (rescored in fix round 1) |
| T4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no shell push names the id stop_shell_push (rescored in fix round 1) |
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
| T4 | 0 | 0 | 3/5 | 5/5 | yes |
| T5 | 0 | 0 | 3/5 | 5/5 | yes |
| T6 | 0 | 0 | 5/5 | 5/5 | yes |
| W1 | 0 | 0 | 5/5 | 5/5 | yes |
| T7 | 0 | 0 | 5/5 | 5/5 | yes |
| T8 | 0 | 0 | 5/5 | 5/5 | yes |
| T9 | 0 | 0 | 5/5 | 5/5 | yes |
| T10 | 0 | 0 | 5/5 | 5/5 | yes |
| S6 | 0 | 0 | 5/5 | 5/5 | yes |
| total | 0 | 0 | 61/65 | 65/65 | yes |

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
and in 13 of 13 scenarios. No fix round was needed on the skill, and the slug
map and SKILL.md are unchanged.

**Stop named**: GREEN 65/65, RED 61/65. RED's four misses are at the two
push-time stops:

- **T4**: rep 2 wrote "the STOP edge" and rep 3 named only the off-script
  gate.
- **T5**: reps 3 and 5 wrote a bare "Stop.".

GREEN's lead comes from those wording habits plus the id rule: two GREEN T4
reps wrote "no shell push", which names `stop_shell_push`. That is a
difference in how reps label the stop, not in where they stop. Every rep on
both sides reached the right node.

As expected, the RED here (today's skill) behaves like the ship-ci lane's
GREEN round 3. At this sample size the measurement can show that short ids
cost nothing. It cannot show that they help.


---

# RED/GREEN: stage-provision short digraph ids

Same question as watch-ci, on the stage-provision stage: are its converted
graph followed no worse? Node text, shapes and edges are the same on both
sides. Only the id form differs.

## Method

- **RED** is the sentence-id SKILL.md at `1043f9eb8`. **GREEN** is the
  short-id SKILL.md at the worktree HEAD (`de9eaf82a`).
- **System files**: `build-system-files.sh 1043f9eb8 t7/red` and
  `build-system-files.sh <worktree> t7/green`; each side's compiled
  `stage-provision.md` is the appended system prompt. It carries the stage's
  graph and the gate-protocol include graph. Sanity checks: `check-dot.py`
  passes on both (2 graphs, 0 warnings). RED has no node labels in the stage
  graph (41 `label=` lines, all on edges); GREEN has 76 (node and edge
  labels). The gate-protocol graph is unconverted on both sides: 36 `label=`
  lines each, all on edges.
- **Prompts**: `../2026-10-16-pipeline-skills/scenarios/S5-occupied-ticket-branch.md`
  and `S5b-precheck-daemon-outdated.md`, unchanged.
- **Recipe**: `run-reps.sh --system <stage-provision.md> --prompt <scenario>`,
  5 reps per scenario per side (20 reps), all exit 0 with non-empty output.
- **Blinding**: `blind.sh` over all four out dirs at once; the 20 transcripts
  were scored in its shuffled order and the mapping was opened afterwards.
  The blind was partial: two GREEN S5 reps write "hand-rolled worktree", which
  is `stop_hand_rolled_worktree` in prose (RED never uses the word). It did not
  change a score.
- **Scoring**: the pipeline lane's S5 and S5b pass criteria. A rep passes a
  scenario only if it meets every clause; each missed clause is a deviation.
  - **S5 clauses**: precheck before any provision; the resume question on
    the `provision` gate; `worktree_provision {repoName, branch:
    "acme-12-fix-login", reuse: true, runDb, stage: "provision"}`;
    `EnterWorktree`; no hand-written `branch`/`worktree` after `recorded: true`.
  - **S5b clauses**: provision with `codes: true` and `runDb`; no precheck
    retry; no stage failure.
  - **Stop named** is yes when the rep says the stage ends done and hands
    back to the orchestrator, the text of `provision_done` ("Provision done:
    return to the orchestrator"). Prose for the id counts.
- **Pass bar**: GREEN deviations at most RED, per scenario and in total.

## Results

### RED

#### S5 occupied ticket branch

| rep | precheck before provision | resume question on the `provision` gate | `worktree_provision` with `reuse`, `branch`, `runDb`, `stage` | `EnterWorktree` | no hand-written `branch`/`worktree` | deviations | stop named | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | yes | yes | 0 | yes | matches the pass criteria |
| 2 | yes | yes | yes | yes | yes | 0 | yes | lists Fresh tree first in the gate; still one resume question |
| 3 | yes | yes | yes | yes | yes | 0 | yes | matches the pass criteria |
| 4 | yes | yes | yes | yes | yes | 0 | yes | matches the pass criteria |
| 5 | yes | yes | yes | yes | yes | 0 | yes | matches the pass criteria |

#### S5b precheck on an older daemon

| rep | `codes: true` and `runDb` | no precheck retry | no stage failure | deviations | stop named | notes |
|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | 0 | yes | matches the pass criteria |
| 2 | yes | yes | yes | 0 | yes | matches the pass criteria |
| 3 | yes | yes | yes | 0 | yes | matches the pass criteria |
| 4 | yes | yes | yes | 0 | yes | matches the pass criteria |
| 5 | yes | yes | yes | 0 | yes | matches the pass criteria |

### GREEN

#### S5 occupied ticket branch

| rep | precheck before provision | resume question on the `provision` gate | `worktree_provision` with `reuse`, `branch`, `runDb`, `stage` | `EnterWorktree` | no hand-written `branch`/`worktree` | deviations | stop named | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | yes | yes | 0 | yes | adds `runDb`/`stage` to the precheck; harmless |
| 2 | yes | yes | yes | yes | yes | 0 | yes | writes "No hand-rolled ... worktree", the id as prose |
| 3 | yes | yes | yes | yes | yes | 0 | yes | matches the pass criteria |
| 4 | yes | yes | yes | yes | yes | 0 | yes | matches the pass criteria |
| 5 | yes | yes | yes | yes | yes | 0 | yes | writes "never hand-rolled a worktree", the id as prose |

#### S5b precheck on an older daemon

| rep | `codes: true` and `runDb` | no precheck retry | no stage failure | deviations | stop named | notes |
|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | 0 | yes | matches the pass criteria |
| 2 | yes | yes | yes | 0 | yes | matches the pass criteria |
| 3 | yes | yes | yes | 0 | yes | matches the pass criteria |
| 4 | yes | yes | yes | 0 | yes | matches the pass criteria |
| 5 | yes | yes | yes | 0 | yes | matches the pass criteria |

### Totals per scenario

| scenario | RED pass | GREEN pass | RED deviations | GREEN deviations | RED stop named | GREEN stop named | GREEN <= RED |
|---|---|---|---|---|---|---|---|
| S5 occupied ticket branch | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | yes |
| S5b precheck on an older daemon | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | yes |
| total | 10/10 | 10/10 | 0 | 0 | 10/10 | 10/10 | yes |

## Verdict

**Pass.** Both sides scored 0 deviations on both scenarios, so GREEN is at
most RED per scenario and in total. No fix round was needed; the slug map and
SKILL.md are unchanged.

Every rep on both sides took the same path. S5: precheck, one `resume_in`
question plus `next`, `gate_answer`, reuse call, `EnterWorktree`, no hand
writes. S5b: `daemon-outdated`, then one provision with `codes`, `runDb`,
`stage` and the budget, no retry, no failure. As in watch-ci, the sample
shows short ids cost nothing here; it cannot show they help.


---

## ship

Same question on the ship verb: is its converted graph followed no worse?
Ship hands off to watch-ci, so both files go in the prompt. Node text,
shapes and edges are the same on both sides. Only the id form differs.

### Method

- **RED** is ship's and watch-ci's SKILL.md at `3aad678d6`, both in
  sentence form (0 node lines carry `label=` in either file). **GREEN** is
  both files at the worktree HEAD (`d7cc81212`): ship converted in
  `2655a9edd`, watch-ci in `2bc073838` (122 and 130 node lines with
  `label=`).
- **Prompt** (`run-reps.sh` input, no `--system`): ship's SKILL.md, then
  watch-ci's SKILL.md, both uncompiled, then the World, Conventions and
  Shared shapes sections of `../2026-10-16-ship-ci-skills/scenarios.md`,
  then its `## ship` section up to the line before `## stage-ship`, then:
  "Follow this skill exactly. For each scenario, list every tool call or
  shell command you would make, in order, with its arguments, and where you
  stop and why. You cannot execute anything." The two `## Ship rules
  (acme/app)` headings sit inside the domain and evidence fill code fences,
  so they belong to `## ship` and both are included, as the lane's ship
  prompt included them. Each rep covers 10 scenarios: S1, S2, S3, S4, S5,
  S5b, S6, T10, EV1 and EV2. Both prompts end on the same bytes, and
  neither contains `expected.md`.
- **Recipe**: `run-reps.sh`, 5 reps per side, RED then GREEN, at most 5 at
  once. All 10 exited 0 with 10.5 to 14.4 KB of output, and every rep
  directory stayed empty.
- **Probe**: one rep was asked to run `echo probe-ok` and `touch probe-file`
  with Bash. It printed made-up tool blocks as text and ran nothing: its rep
  directory stayed empty.
- **Blinding**: `blind.sh` over both out dirs at once. All 10 transcripts
  were scored in its shuffled order and the scores written down before
  `mapping.tsv` was opened. The blind was partial in two ways:
  - One GREEN rep (rep 2) wrote "STOP on shell pushes" in S3. That is
    `stop_shell_push` as prose, and no RED rep uses the phrase. It did not
    change a score.
  - `run-reps.sh` logs each rep's byte count, and the run log was on screen
    before scoring, so the sizes could have unmasked the sides. I did not
    match sizes to blind names while scoring.
- **Scoring**: each scenario of each rep against its
  `../2026-10-16-ship-ci-skills/expected.md` `## ship` entry, on the lane's
  eight columns plus "stop named". A move counts as a deviation only when
  expected.md calls it wrong or names the step as required. Wording never
  counts.
  - Not counted, as in the lane's round 2: a `git rev-parse HEAD` read
    before the push to answer "Push needs force-with-lease (ship)?". No
    result carries HEAD there, and every watch still used `git_push`'s sha.
  - Not counted, as in the lane's round 2: no rep drew `run_budget {key:
    evidence:cover-rounds}` in EV1. That budget lives only in the
    `{{include:evidence-record}}` text, which is unexpanded on both sides.
- **Stop named** is scored two ways. The strict reading is in "Strict stop
  named at STOP nodes" below. The **lenient** reading, used in the per-rep
  tables, is yes when the rep's stop names the node it ends at, by text or
  id. Every ship scenario ends at `run_close_done` → `shipped`
  ("Shipped"), so "Stop: Shipped", "run_close ... done", or a close defined
  once as `run_close {..., outcome: done}` and named per scenario all count.
  In S6 the watch first reaches `stop_lease_holder_owns` ("STOP: the lease
  holder owns every commit, push and retry") and the stand-down. Either
  that text or the done close counts. A bare "Stop." would not count. No
  rep wrote one.
- **Pass bar**: GREEN deviations at most RED, per scenario and in total.

### Results

### RED

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | stop named (lenient) | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | says "the STOP edge" before the git_push refused gate; stop is the done close |
| S3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S3 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | quotes "STOP: push only with git_push" |
| S4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S4 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | reads branch_stack and shipTarget before the branch checks (order only) |
| T10 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |

### GREEN

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | stop named (lenient) | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | writes "STOP on shell pushes": the stop_shell_push id as prose |
| S3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S3 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S4 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | rev-parse HEAD in the force read before the push; no result carries HEAD there and the watch uses git_push's sha (noted, not counted) |
| S5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S5b | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | names no STOP text; the stop is run_close done naming the doctor |
| S6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| S6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| T10 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | no evidence:cover-rounds budget (include unexpanded on both sides; not counted) |
| EV2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |
| EV2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes | matches expected.md |

### Totals per scenario

| scenario | RED deviations | GREEN deviations | RED stop named (lenient) | GREEN stop named (lenient) | GREEN <= RED |
|---|---|---|---|---|---|
| S1 | 0 | 0 | 5/5 | 5/5 | yes |
| S2 | 0 | 0 | 5/5 | 5/5 | yes |
| S3 | 0 | 0 | 5/5 | 5/5 | yes |
| S4 | 0 | 0 | 5/5 | 5/5 | yes |
| S5 | 0 | 0 | 5/5 | 5/5 | yes |
| S5b | 0 | 0 | 5/5 | 5/5 | yes |
| S6 | 0 | 0 | 5/5 | 5/5 | yes |
| T10 | 0 | 0 | 5/5 | 5/5 | yes |
| EV1 | 0 | 0 | 5/5 | 5/5 | yes |
| EV2 | 0 | 0 | 5/5 | 5/5 | yes |
| total | 0 | 0 | 50/50 | 50/50 | yes |

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

### Strict stop named at STOP nodes

Added in review fix round 1. The lenient column credits the terminal
`run_close done` / "Shipped" exit, which every rep names. That hides how
often a rep names a STOP node its path passes through. This table scores
only those nodes, for every ship scenario whose expected.md path passes a
STOP:

- **S3**: `stop_shell_push`, "STOP: push only with git_push (ship)".
- **S6**: watch-ci's `stop_lease_holder_owns`, "STOP: the lease holder owns
  every commit, push and retry (watch-ci)".
- **EV2**: STOP "only the human moves a refused file". This node lives in
  the `{{include:evidence-record}}` text, which is unexpanded in both
  prompts (0 hits for the phrase in either prompt file). No rep could see it.

Rule, the same on both sides:

- **Yes** when the rep names that STOP by its text, or by a close
  paraphrase that keeps "STOP" and the node's content. The id or the slug as
  prose also counts.
- **No** when the rep only describes the behavior ("I do not push from
  Bash"), writes a bare stop ("I stop here"), or writes "the STOP edge" with
  none of the node's content. The last follows this branch's watch-ci
  scoring, where "the STOP edge" scored no at T4.

#### S3: `stop_shell_push`

| side | rep | strict | deciding phrase |
|---|---|---|---|
| RED | 1 | no | "Following the STOP edge, I open the off-script gate" (no node content; would be yes if "the STOP edge" counted) |
| RED | 2 | yes | "I do not retry it and do not use plain `git push`, which is the STOP edge" |
| RED | 3 | yes | "That is the STOP \"push only with git_push\"" |
| RED | 4 | yes | "That triggers STOP: push only with `git_push`" |
| RED | 5 | yes | "STOP: push only with `git_push`" |
| GREEN | 1 | no | "I do not retry it and do not push from Bash" |
| GREEN | 2 | yes | "STOP on shell pushes" (the slug as prose) |
| GREEN | 3 | no | "I stop here and do not retry `git_push` or push from Bash" |
| GREEN | 4 | no | "I do not retry it, and I do not push from a shell" |
| GREEN | 5 | yes | "This hits the STOP: I never push from the shell" |

#### S6: `stop_lease_holder_owns`

| side | rep | strict | deciding phrase |
|---|---|---|---|
| RED | 1 | yes | "That is the STOP edge: the lease holder owns every commit, push and retry" |
| RED | 2 | yes | "That hits the STOP edge: the lease holder owns every commit, push and retry" |
| RED | 3 | yes | "That hits the STOP \"the lease holder owns every commit, push and retry\"" |
| RED | 4 | yes | "That hits STOP: the lease holder owns every commit, push and retry" |
| RED | 5 | yes | "STOP: the lease holder owns every commit, push and retry" |
| GREEN | 1 | yes | "STOP, lease holder owns it" |
| GREEN | 2 | yes | "STOP. The lease holder owns every commit, push and retry" |
| GREEN | 3 | no | "That lease is not mine, so I do not call `ci_lease_release`" |
| GREEN | 4 | no | "I stand down and hand the stand-down back to ship" |
| GREEN | 5 | yes | "This hits STOP: the lease holder owns every commit, push and retry" |

#### EV2: "only the human moves a refused file"

| side | reps | strict | note |
|---|---|---|---|
| RED | 1 to 5 | no x5 | every rep goes straight from the refusal to the off-script gate |
| GREEN | 1 to 5 | no x5 | every rep goes straight from the refusal to the off-script gate |

#### Strict totals

| scenario | RED | GREEN |
|---|---|---|
| S3 | 4/5 (5/5 if "the STOP edge" counts) | 2/5 |
| S6 | 5/5 | 3/5 |
| EV2 | 0/5 | 0/5 |
| total | 9/15 (10/15) | 5/15 |

Lenient totals, for comparison: RED 50/50, GREEN 50/50.

### Verdict

**Pass on deviations.** Both sides scored 0 deviations, so GREEN is at most
RED in total and in 10 of 10 scenarios. No fix round was needed, and `slugs/ship.json`
and the ship SKILL.md are unchanged.

Every rep on both sides took the same path:

- `run_enter` and no `run_list`, `run_start` or `run_stage`.
- No `mr_for_branch` or `mr_pipeline`.
- `mr_create {ifExists: return}` on every create, with `existing: true`
  left as found.
- S3 went to the `git_push refused` gate, then checked the landing with no
  retry.
- S4 went straight to `forceWithLease` and handed the watch 4410.
- S5b handed the watch no prior id.
- S6 stood down with no `ci_lease_release`, and ship closed done naming the
  doctor.
- T10 resumed through the candidates gate with no gate reopened.
- EV1 and EV2 ran `evidence_record` twice, then `evidence_attach`, and EV2
  sent `linkRefused: true` on Take.

**Stop named, lenient**: 50/50 on both sides. Ship's stops are mostly the
done close, which every rep names, so this column has no headroom here.

**Stop named, strict at STOP nodes: GREEN names the STOP less often.**

- **S3**: GREEN names the push STOP in 2/5 reps and RED in 4/5 (5/5 on the
  looser reading).
- **S6**: GREEN names the lease-holder STOP in 3/5 reps and RED in 5/5.
- **Total**: GREEN 5/15, RED 9/15. Neither side could name EV2's STOP,
  because its text was not in the prompt.
- **Behavior**: every GREEN rep that skipped the name still behaved
  correctly. It made no shell push and no retry, reached the gate, and in
  S6 made no release. The gap is in what reps call the node, not in where
  they go.

**Counterpoint**: at the same push STOP in this branch's watch-ci run
(T4), the split went the other way. RED named it 3/5 and GREEN 5/5.

**What the sample shows**: at 5 reps per side, a 2/5 against 4/5 split, or
3/5 against 5/5, is within what chance gives. The watch-ci result reversed
at the same node. So the sample cannot show that short ids make agents name
STOP nodes less often, and it cannot rule that out. It does show that ship
GREEN reps named the STOP less often in this run. The label text is still on
every node, so a GREEN rep sees the same words. The sample cannot say
whether the gap comes from that or from the short id taking the eye.
Telling those apart would need more reps at these nodes.

**Limits**:

- **Ceiling effect.** Both sides scored 0 deviations, as in the watch-ci
  and stage-provision runs. RED is the lane's GREEN text, which already
  passed with 0, so the sample can show that short ids cost nothing here.
  It cannot show that they help.
- **Partial blinding.** See Method: the slug written as prose, and the byte
  counts in the run log.
- **Strict stop named.** At the STOP nodes, GREEN named the STOP in 5/15
  reps against RED's 9/15: S3 2/5 against 4/5, S6 3/5 against 5/5. The
  lenient 50/50 hides this gap. It is recorded here, not resolved. At 5
  reps it is within chance, and watch-ci's T4 went the other way (RED 3/5,
  GREEN 5/5). The strict table was added after review, so it was scored
  unblinded, with the phrases quoted for checking.
- **Self-scoring.** I ran and scored my own reps. A review re-score of 3
  reps agreed on every deviation cell.


---

## gate-protocol

Same question on the gate-protocol include: is its converted graph followed
no worse? The include is inlined into every gating stage, so it is tested
through three of the pipeline lane's scenarios: the gate step with no run,
an unattended wait under a run, and a compacted resume through
`gate_reconcile`. Node text, shapes and edges are the same on both sides.
Only the id form differs.

### Method

- **RED** is `3aad678d6`, where every plugin graph uses sentence ids.
  **GREEN** is the worktree at `c7f1abc2d`: gate-protocol converted in
  `d7cc81212`, work in `e60dd1e93`, stage-plan in `b819b9b42`.
- **System files**: the pipeline lane's
  `../2026-10-16-pipeline-skills/build-system-files.sh 3aad678d6 t11/red`
  and `build-system-files.sh <worktree> t11/green`. The script compiles
  with `bun cli.ts skills compile` under `HOME=<out>/.build/home` and
  `--mattstack-dir <out>/.build/mattstack`, so no compiled rt binary runs and
  nothing touches `~/.mattstack`. It ran unchanged.

  | System file | Scenario | Graphs |
  |---|---|---|
  | `work.md` | S3 compacted resume | `work`, `gate_protocol` (inlined) |
  | `stage-plan.md` | S4 unattended wait | `plan`, `gate_protocol` (inlined) |
  | `board-gate.md` | S8 no run, herdr pane | `gate_protocol` alone |

- **Sanity checks**, all on the built files:
  - `check-dot.py` passes on all three GREEN files (2, 2 and 1 graphs, 0
    warnings), and with `--short-ids` too. RED passes plain `check-dot.py`
    and fails `--short-ids`, as a sentence-id file should.
  - Labels: RED's `gate_protocol` graph has 0 node lines with `label=` (36
    edge labels). GREEN's has 44 node lines with `label=`, one per node (36
    edge labels). The other graphs: `work` 0 against 41, `plan` 0 against 16.
  - With each id resolved to its label, every graph has the same node set,
    the same shapes and the same edges (with their labels) on both sides:
    `work` 41 nodes and 61 edges, `plan` 16 and 17, `gate_protocol` 44 and
    54.
  - With every dot block cut out, RED and GREEN are byte-identical for all
    three files. No part header or version differs: the branch has not
    bumped the plugin version.
  - S3 and S4 also carry the converted `work` and `plan` graphs, so they
    test those conversions together with gate-protocol's. S8 tests
    gate-protocol alone.
- **Prompts**: `../2026-10-16-pipeline-skills/scenarios/S3-compacted-resume.md`,
  `S4-unattended-wait.md` and `S8-no-run-wait.md`, unchanged. S4 is the
  base scenario for all 5 reps. The lane's `runErrors` variant (its reps 4
  and 5) was not run, so the `runErrors` clause is not scored.
- **Recipe**: `run-reps.sh --system <file> --prompt <scenario> --reps 5`,
  RED and GREEN of one scenario at a time (10 reps at once). All 30 exited 0
  with 1.9 to 3.8 KB of output, and every rep directory stayed empty.
- **Blinding**: `blind.sh` over all six out dirs at once. All 30 transcripts
  were scored in its shuffled order and the scores saved before
  `mapping.tsv` was opened. The blind was partial:
  - The run log printed each rep's byte count and out dir before scoring. I
    did not match sizes to blind names while scoring.
  - The scenario is plain from each transcript, so only the side was hidden.
  - No transcript uses a GREEN slug id (a scan for every snake_case id in
    the three GREEN graphs found none), and every phrase quoted from a node
    is the same text on both sides.
- **Scoring**: the pipeline lane's pass criteria for S3, S4 and S8, one
  clause per column. A rep passes only if it meets every clause; each
  missed clause is one deviation.
  - **S3 clauses**: `run_enter {resume: "r-20261016-abc"}`, not `runDb`;
    `gate_reconcile` on `gt-7c2e`; acts on the recorded plan answer without
    re-asking; no new run; no `run_stage start`.
  - **S4 clauses**: `gate_ask` carries `runDb` and `stage: "plan"`; one
    background `rt gate wait gt-5b19`; the turn ends `holding at gate
    gt-5b19`; no AskUserQuestion; no hand-written `gate` or `waiting-gate`;
    on re-entry `gate_reconcile {id, runDb, stage}`.
  - **S8 clauses**: no `runDb` or `stage` on any call; no `run_*` call; one
    background wait; `gate_reconcile {id}` on the doorbell.
  - **Stop named** is yes when the rep names the node its listing ends at,
    by text or id; a slug written as prose counts as the id.
    - S3: `plan_done` ("Plan done: return to the orchestrator") or the
      orchestrator's `follow_stage_file` ("Read the stage file at the
      position and follow it") for the gates file.
    - S4: `plan_done`, where Part 2 ends. Part 1's `holding at gate` is
      already a clause.
    - S8: `end_turn_holding` ("End the turn: holding at gate <id>"), where
      Part 1 ends. Part 2's act is named by every rep because the scenario
      asks for it.
- **Pass bar**: GREEN deviations at most RED, per scenario and in total.

### Results

#### RED

S3 compacted resume:

| rep | `run_enter` with `resume` | `gate_reconcile` | acts on the recorded answer, no re-ask | no new run | no `run_stage start` | deviations | stop named | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | yes | yes | 0 | yes | no `run_decision` for the tier (not a clause) |
| 2 | yes | yes | yes | yes | yes | 0 | yes | quotes "read the stage file at the position and follow it"; no `run_decision` |
| 3 | yes | yes | yes | yes | yes | 0 | yes | no `run_decision` |
| 4 | yes | yes | yes | yes | yes | 0 | yes | no `run_decision` |
| 5 | yes | yes | yes | yes | yes | 0 | yes | no `run_decision` |

S4 unattended wait:

| rep | `gate_ask` with `runDb`, `stage` | one background wait | ends `holding at gate gt-5b19` | no AskUserQuestion | no hand-written `gate`/`waiting-gate` | `gate_reconcile {id, runDb, stage}` | deviations | stop named | notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back` for Go back (the scenario's form says `redirect`); not a clause |
| 2 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back` |
| 3 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back` and says why |
| 4 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back` |
| 5 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back` |

S8 no run, herdr pane:

| rep | no `runDb`/`stage` | no `run_*` call | one background wait | `gate_reconcile {id}` on the doorbell | deviations | stop named | notes |
|---|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | yes | 0 | yes | declines the scripted 2s wait by name |
| 2 | yes | yes | yes | yes | 0 | yes | quotes "Act on the gate answer at the site" |
| 3 | yes | yes | yes | yes | 0 | yes | quotes "Act on the gate answer at the site" |
| 4 | yes | yes | yes | yes | 0 | yes | heads the act "Act on the gate answer at the site" |
| 5 | yes | yes | yes | yes | 0 | yes | matches the pass criteria |

#### GREEN

S3 compacted resume:

| rep | `run_enter` with `resume` | `gate_reconcile` | acts on the recorded answer, no re-ask | no new run | no `run_stage start` | deviations | stop named | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | yes | yes | 0 | yes | quotes "A write-in to act on?"; no `run_decision` |
| 2 | yes | yes | yes | yes | yes | 0 | yes | quotes "A write-in to act on?"; no `run_decision` |
| 3 | yes | yes | yes | yes | yes | 0 | yes | no `run_decision` ("already recorded ... by `gate_reconcile`") |
| 4 | yes | yes | yes | yes | yes | 0 | yes | no `run_decision` |
| 5 | yes | yes | yes | yes | yes | 0 | yes | no `run_decision` |

S4 unattended wait:

| rep | `gate_ask` with `runDb`, `stage` | one background wait | ends `holding at gate gt-5b19` | no AskUserQuestion | no hand-written `gate`/`waiting-gate` | `gate_reconcile {id, runDb, stage}` | deviations | stop named | notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back` |
| 2 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back`; marks `failing_test` write-in too |
| 3 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back` |
| 4 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back`; adds `stage` to `run_decision` |
| 5 | yes | yes | yes | yes | yes | yes | 0 | yes | sends `go-back` |

S8 no run, herdr pane:

| rep | no `runDb`/`stage` | no `run_*` call | one background wait | `gate_reconcile {id}` on the doorbell | deviations | stop named | notes |
|---|---|---|---|---|---|---|---|
| 1 | yes | yes | yes | yes | 0 | yes | matches the pass criteria |
| 2 | yes | yes | yes | yes | 0 | yes | declines the scripted 2s wait by name |
| 3 | yes | yes | yes | yes | 0 | yes | heads the act "Act on the gate answer at the site" |
| 4 | yes | yes | yes | yes | 0 | yes | matches the pass criteria |
| 5 | yes | yes | yes | yes | 0 | yes | matches the pass criteria |

#### Totals per scenario

| scenario | RED pass | GREEN pass | RED deviations | GREEN deviations | RED stop named | GREEN stop named | GREEN <= RED |
|---|---|---|---|---|---|---|---|
| S3 compacted resume | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | yes |
| S4 unattended wait | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | yes |
| S8 no run, herdr pane | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | yes |
| total | 15/15 | 15/15 | 0 | 0 | 15/15 | 15/15 | yes |

### Verdict

**Pass.** Both sides scored 0 deviations on all three scenarios, so GREEN is
at most RED per scenario and in total. No fix round was needed, and
`slugs/gate-protocol.json` and the gate-protocol SKILL.md are unchanged.

Every rep on both sides took the same path:

- S3: `run_enter {resume}`, `run_field_get waiting-gate`, `gate_reconcile`,
  a Read of the plan file, the two field writes, `run_next`, the gates
  file. No `run_list`, clarify question, restart or re-ask.
- S4: `run_field_get ticket`, the printed block, `gate_ask` with `runDb`
  and `stage`, one background wait, `holding at gate gt-5b19`; then
  `gate_reconcile`, `run_decision` and the two field writes. No hand marker.
- S8: `gate_ask` with no run params, one background wait, `holding at gate
  gt-77b0`; on the doorbell `gate_reconcile {id}` and the act. Two reps per
  side named the scripted 2s wait and declined it.

Two shared habits, the same on both sides, so not from the id form:

- No S3 rep, on either side, writes `run_decision` for the tier on the
  resumed Proceed, while every S4 rep does. The resume enters the plan
  graph at the gate's site, and reps read `gate_reconcile`'s record as the
  tier record. The lane's S3 criteria do not ask for it.
- Every S4 rep sends `go-back` as Go back's value, the protocol's value,
  while the scenario's scripted form shows `redirect`. That is a scenario
  wording drift, not a deviation.

**Limits**:

- **Ceiling effect.** Both sides scored 0, as in the watch-ci,
  stage-provision and ship runs. RED is the pipeline lane's GREEN text,
  which already passed these scenarios, so the sample shows that short ids
  cost nothing here. It cannot show that they help.
- **Partial blinding.** See Method: the byte counts in the run log, and the
  scenario visible in every transcript.
- **Self-scoring.** I ran and scored my own reps, with no second scorer.
- **Coverage.** S4's `runErrors` variant was not run, and S3 and S4 test
  the converted `work` and `plan` graphs together with gate-protocol's.

## receive-review

Same question on receive-review: is its converted graph followed no worse?
The compiled verb inlines the gate-protocol include, so both converted
graphs are in play. Node text, shapes and edges are the same on both
sides. Only the id form differs.

### Method

- **RED** is `1726f3a4c` (main, sentence ids). **GREEN** is the worktree
  with receive-review converted in `ada626187` and gate-protocol in
  `033e0d9c7`. Neither file changed between the build and this commit.
- **System files**: the review lane's
  `../2026-10-16-review-skills/build-system-files.sh 1726f3a4c <scratch>/red`
  and `build-system-files.sh <worktree> <scratch>/green`, with no
  `--gate-protocol`. Before the builds I confirmed the script compiles with
  `bun cli.ts skills compile` under `env -i HOME=<out>/.build/home` and
  `--mattstack-dir <out>/.build/mattstack`, so no compiled rt binary runs
  and nothing touches `~/.mattstack`. A probe with an in-repo out dir
  exited 65 ("refusing: <out-dir> ... is inside the repo") and created
  nothing. It ran unchanged. sha1 of the scored files: RED
  `1e2e5813`, GREEN `86d13efe`. Compiled words: 15451 RED, 12974 GREEN
  (edges name short ids).
- **Sanity checks**, all on the built `receive-review.md`:
  - `check-dot.py` passes on GREEN (2 graphs, 0 warnings), and with
    `--short-ids` too. RED passes plain `check-dot.py` and fails
    `--short-ids`, as a sentence-id file should.
  - Labels: RED has 0 node lines with `label=` in both graphs. GREEN has
    129 in `receive_review` and 44 in `gate_protocol`, one per node. Edge
    labels are the same count on both sides (144 and 36).
  - With each id resolved to its label (`dot -Tjson`), each graph has the
    same node set, shapes, styles and edges with their labels on both
    sides: `receive_review` 129 nodes and 212 edges, `gate_protocol` 44
    and 59.
  - With every dot block cut out, RED and GREEN are byte-identical. No
    hunk falls outside a dot block.
- **Prompts**: `../2026-10-16-review-skills/scenarios/` R2, R3, R4, R7 and
  R8, unchanged.
- **Recipe**: `run-reps.sh --system <receive-review.md> --prompt <scenario>
  --reps 5`, RED and GREEN of one scenario at a time (10 reps at once).
  All 50 exited 0 with 3.6 to 9.7 KB of output, and every rep directory
  stayed empty.
- **Blinding**: `blind.sh` over all ten out dirs at once. All 50
  transcripts were scored in its shuffled order and the scores saved
  before `mapping.tsv` was opened. The blind was partial:
  - The run log printed each rep's byte count and its side-named rep dir
    before scoring. I did not match sizes or dirs to blind names.
  - The scenario is plain from each transcript, so only the side was
    hidden.
  - One GREEN rep (R3 rep 2) wrote the slug `held_end_turn`. No other
    transcript uses a GREEN slug that is not also a tool name (a scan for
    all 170 ids in the two GREEN graphs). It did not change a score.
- **Scoring**: the review lane's receive-review pass criteria, one clause
  per column; each missed clause or class A to E deviation counts as one.
  - **R2**: `gate_open {kind: respond-plan, sourcePath, runDb, stage,
    scope: respond-plan}`; `gate_answer`; `gate_record {shape:
    respond-plan, gateId}`; T1 redrafted and offered at respond-post, not
    posted from gate 1; no hand `run_decision`.
  - **R3**: no `gate_record`; no `respond_post_execute`; `run_hold {runDb,
    stage, reason, decidedBy}`; the turn ends held.
  - **R4**: one off-script gate quoting the error; a second
    `respond_post_execute`; `run_field_set {key: hold, value: "-"}`;
    `run_close`; no `mr_reply_thread` and no glab.
  - **R7**: `run_enter {resume: "r-20261016-rev", spawnedBy}`;
    `gate_record {scope: respond-post, shape: respond-post, answers,
    decidedBy: board}`; `respond_post_execute`; no re-adjudication; no new
    run.
  - **R8**: `gate_record`; the gh posted-already read; `git branch
    --show-current`; `git rev-parse --abbrev-ref @{push}`; `git_push
    {tree}`; the gh reply and resolve per thread; no
    `respond_post_execute` and no `mr_*`.
- **Stop named**, two columns:
  - **Lenient**: yes when the rep names the outcome its listing ends at,
    by text or id. R2 `holding at gate gt-702` (gate-protocol's "End the
    turn: holding at gate <id>"); R3 "Held: end the turn naming the run
    and stage"; R4, R7 and R8 "Review feedback answered", or `run_close`
    with `outcome: done`.
  - **Strict STOP named**, under `stop-naming.md`'s rule, scored only
    where the expected path passes a STOP node. In receive-review every
    STOP sits on a "tempted to ..." edge, and none of the five expected
    paths takes one: R2 opens both gates cleanly, R3 holds, R4's held
    reply goes straight to the forge off-script gate, R7 executes, and
    R8's push succeeds. So the strict column is n/a for all five.
    For information only, I also scored R4 for
    `stop_post_outside_execute` ("STOP: post replies only through
    respond_post_execute"), the STOP its scripted `mr_reply_thread`
    result tempts toward.
- **Pass bar**: GREEN deviations at most RED, per scenario and in total.

### Results

Every rep on both sides met every clause of its scenario, so each table
lists the rep, its deviations, its lenient stop phrase and any unscored
note.

#### RED

| scenario | rep | deviations | classes | stop named | deciding phrase | notes |
|---|---|---|---|---|---|---|
| R2 | 1 | 0 | none | yes | "holding at gate gt-702" | |
| R2 | 2 | 0 | none | yes | "holding at gate gt-702" | |
| R2 | 3 | 0 | none | yes | "holding at gate gt-702" | |
| R2 | 4 | 0 | none | yes | "holding at gate gt-702" | |
| R2 | 5 | 0 | none | yes | "holding at gate gt-702" | |
| R3 | 1 | 0 | none | yes | "the run is held ... at stage receive-review" | |
| R3 | 2 | 0 | none | yes | "Held at respond-post on run r-20261016-rev, stage receive-review" | |
| R3 | 3 | 0 | none | yes | "The turn ends held ... held at stage receive-review" | |
| R3 | 4 | 0 | none | yes | "it ends held ... held at stage receive-review" | quotes "Decide nothing at respond-post" |
| R3 | 5 | 0 | none | yes | "it ends in a hold ... held at stage receive-review" | |
| R4 | 1 | 0 | none | yes | "the verb reaches Review feedback answered" | |
| R4 | 2 | 0 | none | yes | "the turn ends at Review feedback answered" | |
| R4 | 3 | 0 | none | yes | "The graph ends at Review feedback answered" | iterate note left out of `gate_answer` |
| R4 | 4 | 0 | none | yes | "stop at Review feedback answered" | |
| R4 | 5 | 0 | none | yes | "finishes at Review feedback answered" | |
| R7 | 1 | 0 | none | yes | "finishes at Review feedback answered" | |
| R7 | 2 | 0 | none | yes | "finishes at Review feedback answered" | |
| R7 | 3 | 0 | none | yes | "Review feedback answered" | |
| R7 | 4 | 0 | none | yes | "finishes at Review feedback answered" | |
| R7 | 5 | 0 | none | yes | "finishes at Review feedback answered" | |
| R8 | 1 | 0 | none | yes | "at Review feedback answered, run closed done" | |
| R8 | 2 | 0 | none | yes | "The terminal state is Review feedback answered" | |
| R8 | 3 | 0 | none | yes | "the turn ends at Review feedback answered" | |
| R8 | 4 | 0 | none | yes | "The turn ends at Review feedback answered" | |
| R8 | 5 | 0 | none | yes | "The turn ends at Review feedback answered" | |

#### GREEN

| scenario | rep | deviations | classes | stop named | deciding phrase | notes |
|---|---|---|---|---|---|---|
| R2 | 1 | 0 | none | yes | "holding at gate gt-702" | extra `mr_view` read |
| R2 | 2 | 0 | none | yes | "holding at gate gt-702" | extra `mr_view` read |
| R2 | 3 | 0 | none | yes | "holding at gate gt-702" | edits the fix with Bash, as no Edit tool is listed |
| R2 | 4 | 0 | none | yes | "holding at gate gt-702" | `git -C ... merge-base` read for the diff range, which no tool covers |
| R2 | 5 | 0 | none | yes | "holding at gate gt-702" | |
| R3 | 1 | 0 | none | yes | "the run is held at stage receive-review ... Held run r-20261016-rev" | |
| R3 | 2 | 0 | none | yes | "ends held, as the held_end_turn outcome" | writes the GREEN slug |
| R3 | 3 | 0 | none | yes | "holding at run r-20261016-rev, stage receive-review" | thread ids as placeholders |
| R3 | 4 | 0 | none | yes | "holding: run r-20261016-rev, stage receive-review" | thread ids as placeholders |
| R3 | 5 | 0 | none | yes | "it ends held ... held at stage receive-review" | |
| R4 | 1 | 0 | none | yes | "the review feedback is answered and the turn ends there" | |
| R4 | 2 | 0 | none | yes | "the Review feedback answered end state" | |
| R4 | 3 | 0 | none | yes | "the verb ends at Review feedback answered" | iterate note left out of `gate_answer` |
| R4 | 4 | 0 | none | yes | "closed done and the review feedback is answered" | |
| R4 | 5 | 0 | none | yes | "run closed done and the review feedback answered" | |
| R7 | 1 | 0 | none | yes | "finishes at Review feedback answered" | |
| R7 | 2 | 0 | none | yes | "at Review feedback answered, run closed done" | |
| R7 | 3 | 0 | none | yes | "closed done at Review feedback answered" | quotes the edge "respond-plan recorded only, a {post} handed" |
| R7 | 4 | 0 | none | yes | "the verb finishes as Review feedback answered" | |
| R7 | 5 | 0 | none | yes | "ends at Review feedback answered" | |
| R8 | 1 | 0 | none | yes | "review feedback is answered, run closed done" | |
| R8 | 2 | 0 | none | yes | "the verb reaches Review feedback answered" | |
| R8 | 3 | 0 | none | yes | "the run closed as done" | the `run_close done` form |
| R8 | 4 | 0 | none | yes | "feedback answered and the run closed done" | |
| R8 | 5 | 0 | none | yes | "it ends at Review feedback answered" | |

#### Totals per scenario

| scenario | RED pass | GREEN pass | RED deviations | GREEN deviations | RED stop named | GREEN stop named | RED strict STOP | GREEN strict STOP | GREEN <= RED |
|---|---|---|---|---|---|---|---|---|---|
| R2 note on a reply | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | n/a | n/a | yes |
| R3 Hold at respond-post | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | n/a | n/a | yes |
| R4 partial post retry | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | n/a | n/a | yes |
| R7 board fresh-pane resume | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | n/a | n/a | yes |
| R8 GitHub proceed | 5/5 | 5/5 | 0 | 0 | 5/5 | 5/5 | n/a | n/a | yes |
| total | 25/25 | 25/25 | 0 | 0 | 25/25 | 25/25 | n/a | n/a | yes |

Class totals: A 0, B 0, C 0, D 0, E 0 on both sides.

Informational, R4 `stop_post_outside_execute`: RED 0/5, GREEN 0/5. Every
rep on both sides declined the hand post in plain words ("I do not call
`mr_reply_thread` by hand") and none wrote "STOP" with the node's
content.

### Verdict

**Pass.** Both sides scored 0 deviations on all five scenarios, so GREEN
is at most RED per scenario and in total. No fix round was needed, and
`slugs/receive-review.json` and the receive-review SKILL.md are unchanged.

Every rep on both sides took the same path:

- R2: `run_enter` started, `mr` and `branch`, `mr_threads {filter:
  "unresolved-human"}`, one adjudicator dispatch, `gate_open {kind:
  respond-plan}`, `code-changes` held back to a second form call, one
  `gate_answer` with `{"value": "reply:T1", "note": "softer"}`,
  `gate_record {gateId: "gt-701"}`, T1 redrafted, the fix committed,
  `gate_open {kind: respond-post}`, one background wait, `holding at gate
  gt-702`.
- R3: `gate_open`, one `gate_answer` with `next: {value: hold, note}`,
  `run_hold {decidedBy: pane}`; no record, no execute.
- R4: `gate_record`, `respond_post_execute`, one off-script `gate_ask`
  quoting T1's 500, its answer, a second `respond_post_execute`, the hold
  clear, `run_close`.
- R7: `run_enter {resume, spawnedBy}`, `run_snapshot`, `gate_record
  {answers, decidedBy: board}`, `respond_post_execute`, the hold clear,
  `run_close`.
- R8: `gate_record`, the gh GraphQL read, the two git reads, `git_push
  {tree}`, gh reply on T1, reply and resolve on T2, `run_close`.

Unscored habits, the same on both sides, so not from the id form: the
R3, R4 and R8 reps left the respond-post `reviewer` as a placeholder (the
fixture names no author on those turns), and one R4 rep per side dropped
the iterate note from the off-script `gate_answer`.

**Limits**:

- **Ceiling effect.** Both sides scored 0, as in the watch-ci,
  stage-provision, ship and gate-protocol runs. RED is the review lane's
  final GREEN text, which already passed these scenarios, so the sample
  shows that short ids cost nothing here. It cannot show that they help.
- **No strict STOP signal.** None of the five expected paths passes a
  STOP node, so this run adds nothing to the STOP-naming question. The
  informational R4 count is 0/5 on both sides.
- **Partial blinding.** See Method: the run log's byte counts and
  side-named rep dirs, one GREEN rep's slug, and the scenario visible in
  every transcript.
- **Self-scoring.** I ran and scored my own reps, with no second scorer.
- **Coverage.** Five of the lane's ten receive-review scenarios: R1, R3b,
  R5, R6 and R7b were not run.
