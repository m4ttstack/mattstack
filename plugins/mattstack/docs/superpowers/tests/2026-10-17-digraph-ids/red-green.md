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
