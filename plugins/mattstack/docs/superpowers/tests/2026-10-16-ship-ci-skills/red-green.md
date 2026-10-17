# RED/GREEN: ship and CI skills

Behavior test for the ship and CI digraph rewrite (superpowers:writing-skills).
Scenarios: `scenarios.md` (shared by both sides, unchanged). Scorer key:
`expected.md` (never in a rep's prompt).

## Recipe

Run 20 fresh describe-only reps per side (5 per skill) with the shepherd's
approved recipe (room message 6019): from a fresh empty directory
`$SCRATCH/reps/<skill>-<n>/`, with the real HOME (keychain login only), run

```bash
claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
  --settings '{"disableAllHooks":true}' --disable-slash-commands \
  --no-session-persistence -p "$(cat <prompt-file>)"
```

`<prompt-file>` holds the skill's SKILL.md (ship and stage-ship reps also get
the watch-ci / stage-watch-ci text for the handoff), the World, Conventions
and Shared shapes sections of `scenarios.md` plus that skill's section, and:
"Follow this skill exactly. For each scenario, list every tool call or shell
command you would make, in order, with its arguments, and where you stop and
why. You cannot execute anything." Probe the recipe once first (a rep that
tries a tool must get none). Save each rep's output to
`$SCRATCH/reps/<skill>-<n>.md`.

RED feeds today's SKILL.md text; GREEN feeds the rewritten text. Same
scenarios, same prompt wording.

## Scoring

Per scenario and run, count:

- shell calls a tool covers;
- hand-held lease calls (claim, heartbeat, release) a tool now owns;
- counters kept in context;
- re-derived values (`git rev-parse`, `mr_pipeline`, `mr_for_branch`) a result already carries;
- skipped steps;
- runaway loops;
- refusals that missed their off-script gate or the stand-down;
- a release on a stand-down.

Fill the spec's deviation table (RED column) with the totals per scenario.
GREEN passes with zero shell deviations, zero hand-held lease calls on GitLab,
every refusal reaching its own off-script gate or the stand-down, and every
counter read through `run_budget`.

## RED

### watch-ci

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | | | | | | | | | |
| T1 | 2 | | | | | | | | | |
| T1 | 3 | | | | | | | | | |
| T1 | 4 | | | | | | | | | |
| T1 | 5 | | | | | | | | | |
| T2 | 1 | | | | | | | | | |
| T2 | 2 | | | | | | | | | |
| T2 | 3 | | | | | | | | | |
| T2 | 4 | | | | | | | | | |
| T2 | 5 | | | | | | | | | |
| T3 | 1 | | | | | | | | | |
| T3 | 2 | | | | | | | | | |
| T3 | 3 | | | | | | | | | |
| T3 | 4 | | | | | | | | | |
| T3 | 5 | | | | | | | | | |
| T3b | 1 | | | | | | | | | |
| T3b | 2 | | | | | | | | | |
| T3b | 3 | | | | | | | | | |
| T3b | 4 | | | | | | | | | |
| T3b | 5 | | | | | | | | | |
| T4 | 1 | | | | | | | | | |
| T4 | 2 | | | | | | | | | |
| T4 | 3 | | | | | | | | | |
| T4 | 4 | | | | | | | | | |
| T4 | 5 | | | | | | | | | |
| T5 | 1 | | | | | | | | | |
| T5 | 2 | | | | | | | | | |
| T5 | 3 | | | | | | | | | |
| T5 | 4 | | | | | | | | | |
| T5 | 5 | | | | | | | | | |
| T6 | 1 | | | | | | | | | |
| T6 | 2 | | | | | | | | | |
| T6 | 3 | | | | | | | | | |
| T6 | 4 | | | | | | | | | |
| T6 | 5 | | | | | | | | | |
| T7 | 1 | | | | | | | | | |
| T7 | 2 | | | | | | | | | |
| T7 | 3 | | | | | | | | | |
| T7 | 4 | | | | | | | | | |
| T7 | 5 | | | | | | | | | |
| T8 | 1 | | | | | | | | | |
| T8 | 2 | | | | | | | | | |
| T8 | 3 | | | | | | | | | |
| T8 | 4 | | | | | | | | | |
| T8 | 5 | | | | | | | | | |
| T9 | 1 | | | | | | | | | |
| T9 | 2 | | | | | | | | | |
| T9 | 3 | | | | | | | | | |
| T9 | 4 | | | | | | | | | |
| T9 | 5 | | | | | | | | | |
| T10 | 1 | | | | | | | | | |
| T10 | 2 | | | | | | | | | |
| T10 | 3 | | | | | | | | | |
| T10 | 4 | | | | | | | | | |
| T10 | 5 | | | | | | | | | |
| S6 | 1 | | | | | | | | | |
| S6 | 2 | | | | | | | | | |
| S6 | 3 | | | | | | | | | |
| S6 | 4 | | | | | | | | | |
| S6 | 5 | | | | | | | | | |

### stage-watch-ci

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | | | | | | | | | |
| T1 | 2 | | | | | | | | | |
| T1 | 3 | | | | | | | | | |
| T1 | 4 | | | | | | | | | |
| T1 | 5 | | | | | | | | | |
| T2 | 1 | | | | | | | | | |
| T2 | 2 | | | | | | | | | |
| T2 | 3 | | | | | | | | | |
| T2 | 4 | | | | | | | | | |
| T2 | 5 | | | | | | | | | |
| T3 | 1 | | | | | | | | | |
| T3 | 2 | | | | | | | | | |
| T3 | 3 | | | | | | | | | |
| T3 | 4 | | | | | | | | | |
| T3 | 5 | | | | | | | | | |
| T3b | 1 | | | | | | | | | |
| T3b | 2 | | | | | | | | | |
| T3b | 3 | | | | | | | | | |
| T3b | 4 | | | | | | | | | |
| T3b | 5 | | | | | | | | | |
| T6 | 1 | | | | | | | | | |
| T6 | 2 | | | | | | | | | |
| T6 | 3 | | | | | | | | | |
| T6 | 4 | | | | | | | | | |
| T6 | 5 | | | | | | | | | |
| T7 | 1 | | | | | | | | | |
| T7 | 2 | | | | | | | | | |
| T7 | 3 | | | | | | | | | |
| T7 | 4 | | | | | | | | | |
| T7 | 5 | | | | | | | | | |
| T9 | 1 | | | | | | | | | |
| T9 | 2 | | | | | | | | | |
| T9 | 3 | | | | | | | | | |
| T9 | 4 | | | | | | | | | |
| T9 | 5 | | | | | | | | | |
| P1 | 1 | | | | | | | | | |
| P1 | 2 | | | | | | | | | |
| P1 | 3 | | | | | | | | | |
| P1 | 4 | | | | | | | | | |
| P1 | 5 | | | | | | | | | |

### ship

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | | | | | | | | | |
| S1 | 2 | | | | | | | | | |
| S1 | 3 | | | | | | | | | |
| S1 | 4 | | | | | | | | | |
| S1 | 5 | | | | | | | | | |
| S2 | 1 | | | | | | | | | |
| S2 | 2 | | | | | | | | | |
| S2 | 3 | | | | | | | | | |
| S2 | 4 | | | | | | | | | |
| S2 | 5 | | | | | | | | | |
| S3 | 1 | | | | | | | | | |
| S3 | 2 | | | | | | | | | |
| S3 | 3 | | | | | | | | | |
| S3 | 4 | | | | | | | | | |
| S3 | 5 | | | | | | | | | |
| S4 | 1 | | | | | | | | | |
| S4 | 2 | | | | | | | | | |
| S4 | 3 | | | | | | | | | |
| S4 | 4 | | | | | | | | | |
| S4 | 5 | | | | | | | | | |
| S5 | 1 | | | | | | | | | |
| S5 | 2 | | | | | | | | | |
| S5 | 3 | | | | | | | | | |
| S5 | 4 | | | | | | | | | |
| S5 | 5 | | | | | | | | | |
| S5b | 1 | | | | | | | | | |
| S5b | 2 | | | | | | | | | |
| S5b | 3 | | | | | | | | | |
| S5b | 4 | | | | | | | | | |
| S5b | 5 | | | | | | | | | |
| S6 | 1 | | | | | | | | | |
| S6 | 2 | | | | | | | | | |
| S6 | 3 | | | | | | | | | |
| S6 | 4 | | | | | | | | | |
| S6 | 5 | | | | | | | | | |
| T10 | 1 | | | | | | | | | |
| T10 | 2 | | | | | | | | | |
| T10 | 3 | | | | | | | | | |
| T10 | 4 | | | | | | | | | |
| T10 | 5 | | | | | | | | | |

### stage-ship

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | | | | | | | | | |
| S1 | 2 | | | | | | | | | |
| S1 | 3 | | | | | | | | | |
| S1 | 4 | | | | | | | | | |
| S1 | 5 | | | | | | | | | |
| S2 | 1 | | | | | | | | | |
| S2 | 2 | | | | | | | | | |
| S2 | 3 | | | | | | | | | |
| S2 | 4 | | | | | | | | | |
| S2 | 5 | | | | | | | | | |
| S3 | 1 | | | | | | | | | |
| S3 | 2 | | | | | | | | | |
| S3 | 3 | | | | | | | | | |
| S3 | 4 | | | | | | | | | |
| S3 | 5 | | | | | | | | | |
| S4 | 1 | | | | | | | | | |
| S4 | 2 | | | | | | | | | |
| S4 | 3 | | | | | | | | | |
| S4 | 4 | | | | | | | | | |
| S4 | 5 | | | | | | | | | |
| S5 | 1 | | | | | | | | | |
| S5 | 2 | | | | | | | | | |
| S5 | 3 | | | | | | | | | |
| S5 | 4 | | | | | | | | | |
| S5 | 5 | | | | | | | | | |
| S5b | 1 | | | | | | | | | |
| S5b | 2 | | | | | | | | | |
| S5b | 3 | | | | | | | | | |
| S5b | 4 | | | | | | | | | |
| S5b | 5 | | | | | | | | | |

### RED totals

(filled after scoring)

## GREEN

### watch-ci

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | | | | | | | | | |
| T1 | 2 | | | | | | | | | |
| T1 | 3 | | | | | | | | | |
| T1 | 4 | | | | | | | | | |
| T1 | 5 | | | | | | | | | |
| T2 | 1 | | | | | | | | | |
| T2 | 2 | | | | | | | | | |
| T2 | 3 | | | | | | | | | |
| T2 | 4 | | | | | | | | | |
| T2 | 5 | | | | | | | | | |
| T3 | 1 | | | | | | | | | |
| T3 | 2 | | | | | | | | | |
| T3 | 3 | | | | | | | | | |
| T3 | 4 | | | | | | | | | |
| T3 | 5 | | | | | | | | | |
| T3b | 1 | | | | | | | | | |
| T3b | 2 | | | | | | | | | |
| T3b | 3 | | | | | | | | | |
| T3b | 4 | | | | | | | | | |
| T3b | 5 | | | | | | | | | |
| T4 | 1 | | | | | | | | | |
| T4 | 2 | | | | | | | | | |
| T4 | 3 | | | | | | | | | |
| T4 | 4 | | | | | | | | | |
| T4 | 5 | | | | | | | | | |
| T5 | 1 | | | | | | | | | |
| T5 | 2 | | | | | | | | | |
| T5 | 3 | | | | | | | | | |
| T5 | 4 | | | | | | | | | |
| T5 | 5 | | | | | | | | | |
| T6 | 1 | | | | | | | | | |
| T6 | 2 | | | | | | | | | |
| T6 | 3 | | | | | | | | | |
| T6 | 4 | | | | | | | | | |
| T6 | 5 | | | | | | | | | |
| T7 | 1 | | | | | | | | | |
| T7 | 2 | | | | | | | | | |
| T7 | 3 | | | | | | | | | |
| T7 | 4 | | | | | | | | | |
| T7 | 5 | | | | | | | | | |
| T8 | 1 | | | | | | | | | |
| T8 | 2 | | | | | | | | | |
| T8 | 3 | | | | | | | | | |
| T8 | 4 | | | | | | | | | |
| T8 | 5 | | | | | | | | | |
| T9 | 1 | | | | | | | | | |
| T9 | 2 | | | | | | | | | |
| T9 | 3 | | | | | | | | | |
| T9 | 4 | | | | | | | | | |
| T9 | 5 | | | | | | | | | |
| T10 | 1 | | | | | | | | | |
| T10 | 2 | | | | | | | | | |
| T10 | 3 | | | | | | | | | |
| T10 | 4 | | | | | | | | | |
| T10 | 5 | | | | | | | | | |
| S6 | 1 | | | | | | | | | |
| S6 | 2 | | | | | | | | | |
| S6 | 3 | | | | | | | | | |
| S6 | 4 | | | | | | | | | |
| S6 | 5 | | | | | | | | | |

### stage-watch-ci

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | | | | | | | | | |
| T1 | 2 | | | | | | | | | |
| T1 | 3 | | | | | | | | | |
| T1 | 4 | | | | | | | | | |
| T1 | 5 | | | | | | | | | |
| T2 | 1 | | | | | | | | | |
| T2 | 2 | | | | | | | | | |
| T2 | 3 | | | | | | | | | |
| T2 | 4 | | | | | | | | | |
| T2 | 5 | | | | | | | | | |
| T3 | 1 | | | | | | | | | |
| T3 | 2 | | | | | | | | | |
| T3 | 3 | | | | | | | | | |
| T3 | 4 | | | | | | | | | |
| T3 | 5 | | | | | | | | | |
| T3b | 1 | | | | | | | | | |
| T3b | 2 | | | | | | | | | |
| T3b | 3 | | | | | | | | | |
| T3b | 4 | | | | | | | | | |
| T3b | 5 | | | | | | | | | |
| T6 | 1 | | | | | | | | | |
| T6 | 2 | | | | | | | | | |
| T6 | 3 | | | | | | | | | |
| T6 | 4 | | | | | | | | | |
| T6 | 5 | | | | | | | | | |
| T7 | 1 | | | | | | | | | |
| T7 | 2 | | | | | | | | | |
| T7 | 3 | | | | | | | | | |
| T7 | 4 | | | | | | | | | |
| T7 | 5 | | | | | | | | | |
| T9 | 1 | | | | | | | | | |
| T9 | 2 | | | | | | | | | |
| T9 | 3 | | | | | | | | | |
| T9 | 4 | | | | | | | | | |
| T9 | 5 | | | | | | | | | |
| P1 | 1 | | | | | | | | | |
| P1 | 2 | | | | | | | | | |
| P1 | 3 | | | | | | | | | |
| P1 | 4 | | | | | | | | | |
| P1 | 5 | | | | | | | | | |

### ship

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | | | | | | | | | |
| S1 | 2 | | | | | | | | | |
| S1 | 3 | | | | | | | | | |
| S1 | 4 | | | | | | | | | |
| S1 | 5 | | | | | | | | | |
| S2 | 1 | | | | | | | | | |
| S2 | 2 | | | | | | | | | |
| S2 | 3 | | | | | | | | | |
| S2 | 4 | | | | | | | | | |
| S2 | 5 | | | | | | | | | |
| S3 | 1 | | | | | | | | | |
| S3 | 2 | | | | | | | | | |
| S3 | 3 | | | | | | | | | |
| S3 | 4 | | | | | | | | | |
| S3 | 5 | | | | | | | | | |
| S4 | 1 | | | | | | | | | |
| S4 | 2 | | | | | | | | | |
| S4 | 3 | | | | | | | | | |
| S4 | 4 | | | | | | | | | |
| S4 | 5 | | | | | | | | | |
| S5 | 1 | | | | | | | | | |
| S5 | 2 | | | | | | | | | |
| S5 | 3 | | | | | | | | | |
| S5 | 4 | | | | | | | | | |
| S5 | 5 | | | | | | | | | |
| S5b | 1 | | | | | | | | | |
| S5b | 2 | | | | | | | | | |
| S5b | 3 | | | | | | | | | |
| S5b | 4 | | | | | | | | | |
| S5b | 5 | | | | | | | | | |
| S6 | 1 | | | | | | | | | |
| S6 | 2 | | | | | | | | | |
| S6 | 3 | | | | | | | | | |
| S6 | 4 | | | | | | | | | |
| S6 | 5 | | | | | | | | | |
| T10 | 1 | | | | | | | | | |
| T10 | 2 | | | | | | | | | |
| T10 | 3 | | | | | | | | | |
| T10 | 4 | | | | | | | | | |
| T10 | 5 | | | | | | | | | |

### stage-ship

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | | | | | | | | | |
| S1 | 2 | | | | | | | | | |
| S1 | 3 | | | | | | | | | |
| S1 | 4 | | | | | | | | | |
| S1 | 5 | | | | | | | | | |
| S2 | 1 | | | | | | | | | |
| S2 | 2 | | | | | | | | | |
| S2 | 3 | | | | | | | | | |
| S2 | 4 | | | | | | | | | |
| S2 | 5 | | | | | | | | | |
| S3 | 1 | | | | | | | | | |
| S3 | 2 | | | | | | | | | |
| S3 | 3 | | | | | | | | | |
| S3 | 4 | | | | | | | | | |
| S3 | 5 | | | | | | | | | |
| S4 | 1 | | | | | | | | | |
| S4 | 2 | | | | | | | | | |
| S4 | 3 | | | | | | | | | |
| S4 | 4 | | | | | | | | | |
| S4 | 5 | | | | | | | | | |
| S5 | 1 | | | | | | | | | |
| S5 | 2 | | | | | | | | | |
| S5 | 3 | | | | | | | | | |
| S5 | 4 | | | | | | | | | |
| S5 | 5 | | | | | | | | | |
| S5b | 1 | | | | | | | | | |
| S5b | 2 | | | | | | | | | |
| S5b | 3 | | | | | | | | | |
| S5b | 4 | | | | | | | | | |
| S5b | 5 | | | | | | | | | |

### GREEN totals

(filled after scoring)
