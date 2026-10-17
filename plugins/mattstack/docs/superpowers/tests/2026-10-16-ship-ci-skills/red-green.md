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
| T1 | 1 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim at opening; run_enter and run_close skipped |
| T1 | 2 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim at opening; run_enter and run_close skipped |
| T1 | 3 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim at opening; run_enter and run_close skipped |
| T1 | 4 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim at opening; run_enter and run_close skipped; passed priorPipelineId 4410 from the result |
| T1 | 5 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim at opening; run_enter and run_close skipped |
| T2 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it (no attend); run_enter skipped; no release |
| T2 | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it (no attend); run_enter skipped; no release |
| T2 | 3 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it (no attend); run_enter skipped; no release |
| T2 | 4 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it (no attend); run_enter skipped; no release |
| T2 | 5 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it (no attend); run_enter skipped; no release |
| T3 | 1 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | claim x2 (opening, before retry); retry count in context; ci_triage, run_enter, run_close skipped; freshWindow |
| T3 | 2 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | claim x2 (opening, before retry); retry count in context; ci_triage, run_enter, run_close skipped; freshWindow |
| T3 | 3 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | claim x2 (opening, before retry); retry count in context; ci_triage, run_enter, run_close skipped; freshWindow |
| T3 | 4 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | claim x2 (opening, before retry); retry count in context; ci_triage, run_enter, run_close skipped; freshWindow |
| T3 | 5 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | claim x2 (opening, before retry); retry count in context; ci_triage, run_enter, run_close skipped; freshWindow |
| T3b | 1 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T3b | 2 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T3b | 3 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T3b | 4 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T3b | 5 | 0 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T4 | 1 | 0 | 3 | 1 | 1 | 3 | 0 | 0 | 0 | claim x3 (opening, before fix, before push); fix round in context; mr_pipeline; ci_triage, run_enter, run_close skipped; off-script gate reached |
| T4 | 2 | 0 | 3 | 1 | 1 | 3 | 0 | 0 | 0 | claim x3 (opening, before fix, before push); fix round in context; mr_pipeline; ci_triage, run_enter, run_close skipped; off-script gate reached |
| T4 | 3 | 0 | 3 | 1 | 1 | 3 | 0 | 0 | 0 | claim x3 (opening, before fix, before push); fix round in context; mr_pipeline; ci_triage, run_enter, run_close skipped; off-script gate reached |
| T4 | 4 | 0 | 3 | 1 | 1 | 3 | 0 | 0 | 0 | claim x3 (opening, before fix, before push); fix round in context; mr_pipeline; ci_triage, run_enter, run_close skipped; off-script gate reached |
| T4 | 5 | 0 | 3 | 1 | 1 | 3 | 0 | 0 | 0 | claim x3 (opening, before fix, before push); fix round in context; mr_pipeline; ci_triage, run_enter, run_close skipped; off-script gate reached |
| T5 | 1 | 0 | 3 | 1 | 1 | 2 | 0 | 0 | 0 | claim x3, last refused, stood down on it; fix round in context; mr_pipeline; ci_triage, run_enter skipped; no release |
| T5 | 2 | 0 | 3 | 1 | 1 | 2 | 0 | 0 | 0 | claim x3, last refused, stood down on it; fix round in context; mr_pipeline; ci_triage, run_enter skipped; no release |
| T5 | 3 | 0 | 3 | 1 | 1 | 2 | 0 | 0 | 0 | claim x3, last refused, stood down on it; fix round in context; mr_pipeline; ci_triage, run_enter skipped; no release |
| T5 | 4 | 0 | 3 | 1 | 1 | 2 | 0 | 0 | 0 | claim x3, last refused, stood down on it; fix round in context; mr_pipeline; ci_triage, run_enter skipped; no release |
| T5 | 5 | 0 | 3 | 1 | 1 | 2 | 0 | 0 | 0 | claim x3, last refused, stood down on it; fix round in context; mr_pipeline; ci_triage, run_enter skipped; no release |
| T6 | 1 | 0 | 1 | 1 | 2 | 2 | 0 | 0 | 0 | claim; waiting count in context; ls-remote, rev-parse HEAD; run_enter, run_close skipped |
| T6 | 2 | 0 | 1 | 1 | 3 | 2 | 0 | 0 | 0 | claim; waiting count in context; ls-remote, rev-parse HEAD, status -sb; run_enter, run_close skipped |
| T6 | 3 | 0 | 1 | 1 | 1 | 2 | 0 | 0 | 0 | claim; waiting count in context; ls-remote; run_enter, run_close skipped |
| T6 | 4 | 0 | 1 | 1 | 3 | 2 | 0 | 0 | 0 | claim; waiting count in context; ls-remote, rev-parse HEAD, status -sb; run_enter, run_close skipped |
| T6 | 5 | 0 | 1 | 1 | 2 | 2 | 0 | 0 | 0 | claim; waiting count in context; ls-remote, rev-parse HEAD; run_enter, run_close skipped |
| T7 | 1 | 0 | 1 | 0 | 0 | 3 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); run_enter, run_close skipped |
| T7 | 2 | 0 | 1 | 0 | 0 | 3 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); run_enter, run_close skipped |
| T7 | 3 | 0 | 1 | 0 | 0 | 3 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); run_enter, run_close skipped |
| T7 | 4 | 0 | 1 | 0 | 0 | 3 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); run_enter, run_close skipped |
| T7 | 5 | 0 | 1 | 0 | 0 | 3 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); run_enter, run_close skipped |
| T8 | 1 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | GitHub claim and heartbeat expected; poll ceiling and retry count in context; run_enter, run_close skipped |
| T8 | 2 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | GitHub claim and heartbeat expected; poll ceiling and retry count in context; run_enter, run_close skipped |
| T8 | 3 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | GitHub claim and heartbeat expected; poll ceiling and retry count in context; run_enter, run_close skipped |
| T8 | 4 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | GitHub claim and heartbeat expected; poll ceiling and retry count in context; run_enter, run_close skipped |
| T8 | 5 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | GitHub claim and heartbeat expected; poll ceiling and retry count in context; run_enter, run_close skipped |
| T9 | 1 | 1 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | ci-triage.sh (forge jobs only offered, not counted); claim x2; retry count in context; ci_triage, run_enter, run_close skipped |
| T9 | 2 | 1 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | ci-triage.sh; claim x2; retry count in context; ci_triage, run_enter, run_close skipped |
| T9 | 3 | 1 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | ci-triage.sh; claim x2; retry count in context; ci_triage, run_enter, run_close skipped |
| T9 | 4 | 1 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | ci-triage.sh; claim x2; retry count in context; ci_triage, run_enter, run_close skipped |
| T9 | 5 | 1 | 2 | 1 | 0 | 3 | 0 | 0 | 0 | ci-triage.sh; claim x2; retry count in context; ci_triage, run_enter, run_close skipped |
| T10 | 1 | 0 | 1 | 0 | 1 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch over run fields; claim; run_close skipped |
| T10 | 2 | 0 | 1 | 0 | 1 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch over run fields; claim; run_close skipped |
| T10 | 3 | 0 | 1 | 0 | 1 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch over run fields; claim; run_close skipped |
| T10 | 4 | 0 | 1 | 0 | 1 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch over run fields; claim; run_close skipped |
| T10 | 5 | 0 | 1 | 0 | 1 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch over run fields; claim; run_close skipped |
| S6 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | run_snapshot in place of run_enter; claim refused, stood down on it; no release, no close |
| S6 | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | run_snapshot in place of run_enter; claim refused, stood down on it; no release, no close |
| S6 | 3 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | run_snapshot in place of run_enter; claim refused, stood down on it; no release, no close |
| S6 | 4 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | run_snapshot in place of run_enter; claim refused, stood down on it; no release, no close |
| S6 | 5 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | run_snapshot in place of run_enter; claim refused, stood down on it; no release, no close |

### stage-watch-ci

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read, so no prior id from the field |
| T1 | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read, so no prior id from the field |
| T1 | 3 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read, so no prior id from the field |
| T1 | 4 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read; passed 4410 only because the result returned it |
| T1 | 5 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read; passed 4410 only because the result returned it |
| T2 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it; pushed not read; no release, no ci write |
| T2 | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it; pushed not read; no release, no ci write |
| T2 | 3 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it; pushed not read; no release, no ci write |
| T2 | 4 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it; pushed not read; no release, no ci write |
| T2 | 5 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim refused, stood down on it; pushed not read; no release, no ci write |
| T3 | 1 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | claim x2; retry count in context; pushed not read; ci_triage skipped; freshWindow |
| T3 | 2 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | claim x2; retry count in context; pushed not read; ci_triage skipped; freshWindow |
| T3 | 3 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | claim x2; retry count in context; pushed not read; ci_triage skipped; freshWindow |
| T3 | 4 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | claim x2; retry count in context; pushed not read; ci_triage skipped; freshWindow |
| T3 | 5 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | claim x2; retry count in context; pushed not read; ci_triage skipped; freshWindow |
| T3b | 1 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T3b | 2 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T3b | 3 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T3b | 4 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T3b | 5 | 0 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | as T3; no ci_triage call, so the tool error path never ran |
| T6 | 1 | 0 | 1 | 1 | 2 | 1 | 0 | 0 | 0 | claim; waiting count in context; second rev-parse HEAD, ls-remote; pushed not read |
| T6 | 2 | 0 | 1 | 1 | 2 | 1 | 0 | 0 | 0 | claim; waiting count in context; second rev-parse HEAD, ls-remote; pushed not read |
| T6 | 3 | 0 | 1 | 1 | 2 | 1 | 0 | 0 | 0 | claim; waiting count in context; second rev-parse HEAD, ls-remote; pushed not read |
| T6 | 4 | 0 | 1 | 1 | 2 | 1 | 0 | 0 | 0 | claim; waiting count in context; second rev-parse HEAD, ls-remote; pushed not read |
| T6 | 5 | 0 | 1 | 1 | 2 | 1 | 0 | 0 | 0 | claim; waiting count in context; second rev-parse HEAD, ls-remote; pushed not read |
| T7 | 1 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); pushed not read |
| T7 | 2 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); pushed not read |
| T7 | 3 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); pushed not read |
| T7 | 4 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); pushed not read |
| T7 | 5 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | claim; ci_triage skipped, gated as unclear (INHERITED never seen); pushed not read |
| T9 | 1 | 1 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | ci-triage.sh with --config; claim x2; retry count in context; ci_triage and pushed read skipped |
| T9 | 2 | 1 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | ci-triage.sh with --config; claim x2; retry count in context; ci_triage and pushed read skipped |
| T9 | 3 | 1 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | ci-triage.sh with --config; claim x2; retry count in context; ci_triage and pushed read skipped |
| T9 | 4 | 1 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | ci-triage.sh with --config; claim x2; retry count in context; ci_triage and pushed read skipped |
| T9 | 5 | 1 | 2 | 1 | 0 | 2 | 0 | 0 | 0 | ci-triage.sh with --config; claim x2; retry count in context; ci_triage and pushed read skipped |
| P1 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read, watched B without prior id 4415 |
| P1 | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read, watched B without prior id 4415 |
| P1 | 3 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read, watched B without prior id 4415 |
| P1 | 4 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read, watched B without prior id 4415 |
| P1 | 5 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | claim; pushed not read, watched B without prior id 4415 |

### ship

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch before and after push; run_enter, run_close skipped; mr_create without ifExists |
| S1 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch before and after push; run_enter, run_close skipped; mr_create without ifExists |
| S1 | 3 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch before and after push; run_enter, run_close skipped; mr_create without ifExists |
| S1 | 4 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch before and after push; run_enter, run_close skipped; mr_create without ifExists |
| S1 | 5 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch before and after push; run_enter, run_close skipped; mr_create without ifExists |
| S2 | 1 | 0 | 0 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; mr_create skipped (url from mr_for_branch); run_enter, run_close skipped |
| S2 | 2 | 0 | 0 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; mr_create skipped (url from mr_for_branch); run_enter, run_close skipped |
| S2 | 3 | 0 | 0 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; mr_create skipped (url from mr_for_branch); run_enter, run_close skipped |
| S2 | 4 | 0 | 0 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; mr_create skipped (url from mr_for_branch); run_enter, run_close skipped |
| S2 | 5 | 0 | 0 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; mr_create skipped (url from mr_for_branch); run_enter, run_close skipped |
| S3 | 1 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch x2; off-script gate reached, Take confirmed with rev-parse and ls-remote; run_enter, run_close skipped |
| S3 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch x2; off-script gate reached, Take confirmed with rev-parse and ls-remote; run_enter, run_close skipped |
| S3 | 3 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch x2; off-script gate reached, Take confirmed with rev-parse and ls-remote; run_enter, run_close skipped |
| S3 | 4 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch x2; off-script gate reached, Take confirmed with rev-parse and ls-remote; run_enter, run_close skipped |
| S3 | 5 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | mr_for_branch x2; off-script gate reached, Take confirmed with rev-parse and ls-remote; run_enter, run_close skipped |
| S4 | 1 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped; forceWithLease first (right) |
| S4 | 2 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped; forceWithLease first (right) |
| S4 | 3 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped; forceWithLease first (right) |
| S4 | 4 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped; forceWithLease first (right) |
| S4 | 5 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped; forceWithLease first (right) |
| S5 | 1 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped |
| S5 | 2 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped |
| S5 | 3 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped |
| S5 | 4 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped |
| S5 | 5 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD, mr_pipeline; claim in the inherited watch; mr_create, run_enter, run_close skipped |
| S5b | 1 | 0 | 1 | 0 | 3 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD; claim; mr_create, run_enter, run_close skipped; no prior id handed (right) |
| S5b | 2 | 0 | 1 | 0 | 3 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD; claim; mr_create, run_enter, run_close skipped; no prior id handed (right) |
| S5b | 3 | 0 | 1 | 0 | 3 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD; claim; mr_create, run_enter, run_close skipped; no prior id handed (right) |
| S5b | 4 | 0 | 1 | 0 | 3 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD; claim; mr_create, run_enter, run_close skipped; no prior id handed (right) |
| S5b | 5 | 0 | 1 | 0 | 3 | 3 | 0 | 0 | 0 | mr_for_branch x2, rev-parse HEAD; claim; mr_create, run_enter, run_close skipped; no prior id handed (right) |
| S6 | 1 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | as S5 to the watch; claim refused, stood down on it; no release; mr_create, run_enter, run_close skipped |
| S6 | 2 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | as S5 to the watch; claim refused, stood down on it; no release; mr_create, run_enter, run_close skipped |
| S6 | 3 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | as S5 to the watch; claim refused, stood down on it; no release; mr_create, run_enter, run_close skipped |
| S6 | 4 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | as S5 to the watch; claim refused, stood down on it; no release; mr_create, run_enter, run_close skipped |
| S6 | 5 | 0 | 1 | 0 | 4 | 3 | 0 | 0 | 0 | as S5 to the watch; claim refused, stood down on it; no release; mr_create, run_enter, run_close skipped |
| T10 | 1 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch x2; run_close skipped |
| T10 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch x2; run_close skipped |
| T10 | 3 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch x2; run_close skipped |
| T10 | 4 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch x2; run_close skipped |
| T10 | 5 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | run_list, hand-built runDb, run_stage start, hold clear in place of run_enter resume; mr_for_branch x2; run_close skipped |

### stage-ship

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | mr_for_branch after push; pushed not written |
| S1 | 2 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | mr_for_branch after push; pushed not written |
| S1 | 3 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | mr_for_branch after push; pushed not written |
| S1 | 4 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | mr_for_branch after push; pushed not written |
| S1 | 5 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | mr_for_branch after push; pushed not written |
| S2 | 1 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch over the push result; pushed not written; mr_create skipped |
| S2 | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch over the push result; pushed not written; mr_create skipped |
| S2 | 3 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch over the push result; pushed not written; mr_create skipped |
| S2 | 4 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch over the push result; pushed not written; mr_create skipped |
| S2 | 5 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch over the push result; pushed not written; mr_create skipped |
| S3 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | mr_for_branch; pushed not written; landing confirmed (rev-parse, ls-remote); off-script gate reached |
| S3 | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; landing not confirmed after Take; off-script gate reached |
| S3 | 3 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; ls-remote only offered, landing not confirmed; off-script gate reached |
| S3 | 4 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; landing not confirmed after Take; off-script gate reached |
| S3 | 5 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; landing not confirmed after Take; off-script gate reached |
| S4 | 1 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; forceWithLease first (right); no mr_update per the fill |
| S4 | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; forceWithLease first (right); no mr_update per the fill |
| S4 | 3 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; forceWithLease first (right); no mr_update per the fill |
| S4 | 4 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; forceWithLease first (right); no mr_update per the fill |
| S4 | 5 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; forceWithLease first (right); no mr_update per the fill |
| S5 | 1 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5 | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5 | 3 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5 | 4 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5 | 5 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5b | 1 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5b | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5b | 3 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5b | 4 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |
| S5b | 5 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | mr_for_branch; pushed not written; mr_create skipped; no mr_update per the fill |

### RED totals

| skill | shell | lease | counters | re-derived | skipped | runaway | refusal missed | release on stand-down | total |
|---|---|---|---|---|---|---|---|---|---|
| watch-ci | 5 | 90 | 40 | 26 | 135 | 0 | 0 | 0 | 296 |
| stage-watch-ci | 5 | 55 | 20 | 10 | 60 | 0 | 0 | 0 | 150 |
| ship | 0 | 20 | 0 | 125 | 105 | 0 | 0 | 0 | 250 |
| stage-ship | 0 | 0 | 0 | 30 | 54 | 0 | 0 | 0 | 84 |

How the cells were counted:

- Skipped steps are steps in `expected.md` that the rep never took: `run_enter` (the rep used `run_list`/`run_start`/`run_stage start`, or `run_snapshot` on an inherited run), `run_close` (the rep used `run_stage done`/`run_status`), `ci_triage`, the `pushed` read or write, `mr_create {ifExists}` on an open MR, and the S3 landing check.
- Hand-held lease calls count `ci_lease_claim` and `ci_lease_heartbeat` on GitLab. A release at a normal exit is expected, so it is not counted. T8 (GitHub) claims and heartbeats are expected.
- Counters in context count one per budget the rep tracked by hand instead of with `run_budget`: infra retries, fix rounds, waiting results, and GitHub polls.
- Re-derived values: `mr_for_branch`, `mr_pipeline`, `git rev-parse HEAD`, and the post-watch push checks (`ls-remote`, `status -sb`) when a result already carries the value. The pre-push HEAD-vs-MR comparison counts as a `rev-parse` whether or not the rep named the command.
- Only calls the rep committed to are counted. A call the rep offered on a condition ("I may also run `<forge> jobs`") goes in the notes.

The 10 stage reps were re-run with the full scenario data (the first round is in `reps/red-v1/`).

#### RED findings: watch-ci

- `ci_lease_claim` by hand: 90 calls across 55/55 GitLab runs (one to three per run).
- `run_enter` skipped: 60/60 runs. `run_close` skipped: 45/45 runs that close.
- `ci_triage` never called: 30/30 runs that triage. T7 was gated as "unclear" and never as INHERITED (5/5). T3b never reached the tool-error path (5/5).
- Counters in context, with no `run_budget` calls: 40 (retries, fix rounds, waiting results, GitHub polls).
- Stand-downs: all reached through a refused claim, never through `ci_watch {attend}` (15/15). There were no releases on a stand-down (0/15). The T4 off-script gate was reached 5/5, and T9 ran `ci-triage.sh` 5/5.

#### RED findings: stage-watch-ci

- `ci_lease_claim` by hand: 55 calls across 40/40 runs.
- `pushed` never read: 40/40. P1 watched B without prior id 4415 (5/5).
- `ci_triage` never called: 20/20 runs that triage. T7 was gated as "unclear", not INHERITED (5/5).
- Counters in context: 20. T9 ran `ci-triage.sh --config`: 5/5.
- T6 checked the push by hand (a second `rev-parse HEAD` plus `ls-remote`): 5/5. T2 stood down on the refused claim with no release: 5/5.

#### RED findings: ship

- `mr_for_branch` re-derived before and after `git_push`: 80 calls across 40/40 runs.
- `mr_pipeline` plus `git rev-parse HEAD` where the push result carries the value: 20 and 25 calls (S2, S4, S5, S5b, S6).
- `mr_create {ifExists}` never used. On an open MR the create was skipped and the url taken from `mr_for_branch` (25/25). S1, S3 and T10 created without it (15/15).
- `run_enter` skipped and `run_close` skipped: 40/40 each.
- `ci_lease_claim` in the inherited watch: 20/20. S6 stood down on the refused claim with no release (5/5). S3 reached its off-script gate (5/5). S4 used forceWithLease first (5/5). S5b handed no prior id (5/5).

#### RED findings: stage-ship

- `pushed` never written: 30/30.
- `mr_for_branch` re-derived after `git_push`: 30/30.
- `mr_create {ifExists}` skipped on an open MR: 20/20.
- S3 landing not confirmed after Take: 4/5.
- S3 reached its off-script gate (5/5), and S4 used forceWithLease with no plain push first (5/5). With the fill in hand, S4, S5 and S5b skipped `mr_update` per its rule (15/15, not counted).

## GREEN

### watch-ci

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; ci_watch twice (4410 from the result, as the skill says); mr_view, mark-ready, mr_ready; release; run_close done |
| T1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; ci_watch twice (4410 from the result, as the skill says); mr_view, mark-ready, mr_ready; release; run_close done |
| T1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; ci_watch twice (4410 from the result, as the skill says); mr_view, mark-ready, mr_ready; release; run_close done |
| T1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; ci_watch twice (4410 from the result, as the skill says); mr_view, mark-ready, mr_ready; release; run_close done |
| T1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; ci_watch twice (4410 from the result, as the skill says); mr_view, mark-ready, mr_ready; release; run_close done |
| T2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down from ci_watch; STOP; no release, no run_close |
| T2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down from ci_watch; STOP; no release, no run_close |
| T2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down from ci_watch; STOP; no release, no run_close |
| T2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down from ci_watch; STOP; no release, no run_close |
| T2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down from ci_watch; STOP; no release, no run_close |
| T3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; release; run_close done |
| T3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; release; run_close done |
| T3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; release; run_close done |
| T3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; release; run_close done |
| T3 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; release; run_close done |
| T3b | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage 502 quoted; classified from failedJobs; no ci-triage.sh |
| T3b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage 502 quoted; classified from failedJobs; no ci-triage.sh |
| T3b | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage 502 quoted; classified from failedJobs; no ci-triage.sh |
| T3b | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage 502 quoted; classified from failedJobs; no ci-triage.sh |
| T3b | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage 502 quoted; classified from failedJobs; no ci-triage.sh |
| T4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci gate Fix; run_budget fix-rounds; git_push refused; off-script gate, Hand back; release; run_close failed |
| T4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci gate Fix; run_budget fix-rounds; git_push refused; off-script gate, Hand back; release; run_close failed |
| T4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci gate Fix; run_budget fix-rounds; git_push refused; off-script gate, Hand back; release; run_close failed |
| T4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci gate Fix; run_budget fix-rounds; git_push refused; off-script gate, Hand back; release; run_close failed |
| T4 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci gate Fix; run_budget fix-rounds; git_push refused; off-script gate, Hand back; release; run_close failed |
| T5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_push lease_held; STOP, stand-down; no release, no unguarded push |
| T5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_push lease_held; STOP, stand-down; no release, no unguarded push |
| T5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_push lease_held; STOP, stand-down; no release, no unguarded push |
| T5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_push lease_held; STOP, stand-down; no release, no unguarded push |
| T5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_push lease_held; STOP, stand-down; no release, no unguarded push |
| T6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | waiting, then no_pipeline; ci gate quotes remoteSha; Hand back; release; run_close done |
| T6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | waiting, then no_pipeline; ci gate quotes remoteSha; Hand back; release; run_close done |
| T6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | waiting, then no_pipeline; ci gate quotes remoteSha; Hand back; release; run_close done |
| T6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | waiting, then no_pipeline; ci gate quotes remoteSha; Hand back; release; run_close done |
| T6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | waiting, then no_pipeline; ci gate quotes remoteSha; Hand back; release; run_close done |
| T7 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED named at the ci gate; no retry |
| T7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED named at the ci gate; no retry |
| T7 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED named at the ci gate; no retry |
| T7 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED named at the ci gate; no retry |
| T7 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED named at the ci gate; no retry |
| T8 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | claim, github-polls budget, heartbeat, background sleep, sha guard, infra budget, re-claim, rerun (all drawn) |
| T8 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | claim, github-polls budget, heartbeat, background sleep, sha guard, infra budget, re-claim, rerun (all drawn) |
| T8 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | claim, github-polls budget, heartbeat, background sleep, sha guard, infra budget, re-claim, rerun (all drawn) |
| T8 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | claim, github-polls budget, heartbeat, background sleep, sha guard, infra budget, re-claim, rerun (all drawn) |
| T8 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | claim, github-polls budget, heartbeat, background sleep, sha guard, infra budget, re-claim, rerun (all drawn) |
| T9 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | read ci-config.json; ci_triage with config; no script, no <forge> calls |
| T9 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | read ci-config.json; ci_triage with config; no script, no <forge> calls |
| T9 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | read ci-config.json; ci_triage with config; no script, no <forge> calls |
| T9 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | read ci-config.json; ci_triage with config; no script, no <forge> calls |
| T9 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | read ci-config.json; ci_triage with config; no script, no <forge> calls |
| T10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | resume via run_enter; run_snapshot; recorded mr used as named, no mr_for_branch |
| T10 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | resume via run_enter; run_snapshot; then mr_for_branch re-run although the run's mr field holds the MR (identity re-set too) |
| T10 | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | resume via run_enter; run_snapshot; then mr_for_branch re-run although the run's mr field holds the MR (identity re-set too) |
| T10 | 4 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | resume via run_enter; run_snapshot; then mr_for_branch re-run although the run's mr field holds the MR (identity re-set too) |
| T10 | 5 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | resume via run_enter; run_snapshot; then mr_for_branch re-run although the run's mr field holds the MR (identity re-set too) |
| S6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | inherited; stood_down; handed back; no release, no run_close |
| S6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | inherited; stood_down; handed back; no release, no run_close |
| S6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | inherited; stood_down; handed back; no release, no run_close |
| S6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | inherited; stood_down; handed back; no release, no run_close |
| S6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | inherited; stood_down; handed back; no release, no run_close |

### stage-watch-ci

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed read; rev-parse HEAD (drawn); prior 4410; mark-ready; ci green; release |
| T1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed read; rev-parse HEAD (drawn); prior 4410; mark-ready; ci green; release |
| T1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed read; rev-parse HEAD (drawn); prior 4410; mark-ready; ci green; release |
| T1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed read; rev-parse HEAD (drawn); prior 4410; mark-ready; ci green; release |
| T1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed read; rev-parse HEAD (drawn); prior 4410; mark-ready; ci green; release |
| T2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down; no ci write, no release |
| T2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down; no ci write, no release |
| T2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down; no ci write, no release |
| T2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down; no ci write, no release |
| T2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down; no ci write, no release |
| T3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; ci green; release |
| T3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; ci green; release |
| T3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; ci green; release |
| T3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; ci green; release |
| T3 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage; run_budget infra-retries:<sha12>; mr_retry leaseMrUrl; ci green; release |
| T3b | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 502 quoted; classified from failedJobs; no script |
| T3b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 502 quoted; classified from failedJobs; no script; mr_job_trace read (allowed) |
| T3b | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 502 quoted; classified from failedJobs; no script |
| T3b | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 502 quoted; classified from failedJobs; no script; mr_job_trace read (allowed) |
| T3b | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 502 quoted; classified from failedJobs; no script |
| T6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed unset, so HEAD and no prior id; ci gate; ci red; release |
| T6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed unset, so HEAD and no prior id; ci gate; ci red; release |
| T6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed unset, so HEAD and no prior id; ci gate; ci red; release |
| T6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed unset, so HEAD and no prior id; ci gate; ci red; release |
| T6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed unset, so HEAD and no prior id; ci gate; ci red; release |
| T7 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED at the ci gate; ci red; release |
| T7 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED at the ci gate; ci red; release |
| T7 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED at the ci gate; ci red; release |
| T7 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED at the ci gate; ci red; release |
| T7 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | INHERITED at the ci gate; ci red; release |
| T9 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage with config; no script |
| T9 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage with config; no script |
| T9 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage with config; no script |
| T9 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage with config; no script |
| T9 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ci_triage with config; no script |
| P1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} matched HEAD; no mr_pipeline |
| P1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} matched HEAD; no mr_pipeline |
| P1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} matched HEAD; no mr_pipeline |
| P1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} matched HEAD; no mr_pipeline |
| P1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} matched HEAD; no mr_pipeline |

### ship

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; git_push; mr_create ifExists (created); no mr_for_branch; run_close done |
| S1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; git_push; mr_create ifExists (created); no mr_for_branch; run_close done |
| S1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; git_push; mr_create ifExists (created); no mr_for_branch; run_close done |
| S1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; git_push; mr_create ifExists (created); no mr_for_branch; run_close done |
| S1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | run_enter; git_push; mr_create ifExists (created); no mr_for_branch; run_close done |
| S2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | mr_create existing: true, left as found; no mr_for_branch, no mr_pipeline |
| S2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | mr_create existing: true, left as found; no mr_for_branch, no mr_pipeline |
| S2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | mr_create existing: true, left as found; no mr_for_branch, no mr_pipeline |
| S2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | mr_create existing: true, left as found; no mr_for_branch, no mr_pipeline |
| S2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | mr_create existing: true, left as found; no mr_for_branch, no mr_pipeline |
| S3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked (rev-parse vs ls-remote, drawn); mr_create; run_close done |
| S3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked (rev-parse vs ls-remote, drawn); mr_create; run_close done |
| S3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked (rev-parse vs ls-remote, drawn); mr_create; run_close done |
| S3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked (rev-parse vs ls-remote, drawn); mr_create; run_close done |
| S3 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked (rev-parse vs ls-remote, drawn); mr_create; run_close done |
| S4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_rebase; force decided from the scripted log/merge-base reads; forceWithLease first; watch-ci handed A + 4410 |
| S4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_rebase; force decided from the scripted log/merge-base reads; forceWithLease first; watch-ci handed A + 4410 |
| S4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_rebase; force decided from the scripted log/merge-base reads; forceWithLease first; watch-ci handed A + 4410; also git rev-parse HEAD in the force check (no result carried HEAD yet, not counted) |
| S4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_rebase; force decided from the scripted log/merge-base reads; forceWithLease first; watch-ci handed A + 4410 |
| S4 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | git_rebase; force decided from the scripted log/merge-base reads; forceWithLease first; watch-ci handed A + 4410 |
| S5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | plain push; watch-ci handed B + 4415 from the push result; mr_ready |
| S5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | plain push; watch-ci handed B + 4415 from the push result; mr_ready |
| S5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | plain push; watch-ci handed B + 4415 from the push result; mr_ready; also git rev-parse HEAD in the force check (no result carried HEAD yet, not counted) |
| S5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | plain push; watch-ci handed B + 4415 from the push result; mr_ready |
| S5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | plain push; watch-ci handed B + 4415 from the push result; mr_ready |
| S5b | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no prior id handed; ci_watch {sha: A} green on 4410 |
| S5b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no prior id handed; ci_watch {sha: A} green on 4410 |
| S5b | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no prior id handed; ci_watch {sha: A} green on 4410 |
| S5b | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no prior id handed; ci_watch {sha: A} green on 4410 |
| S5b | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | no prior id handed; ci_watch {sha: A} green on 4410 |
| S6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down in the inherited watch; no release; ship closes done naming the doctor |
| S6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down in the inherited watch; no release; ship closes done naming the doctor |
| S6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down in the inherited watch; no release; ship closes done naming the doctor |
| S6 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down in the inherited watch; no release; ship closes done naming the doctor |
| S6 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | stood_down in the inherited watch; no release; ship closes done naming the doctor |
| T10 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | candidates gate; run_enter resume; run_snapshot; branch_stack + shipTarget match; earlier Proceed kept |
| T10 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | candidates gate; run_enter resume; run_snapshot; branch_stack + shipTarget match; earlier Proceed kept |
| T10 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | candidates gate; run_enter resume; run_snapshot; branch_stack + shipTarget match; earlier Proceed kept |
| T10 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | candidates gate; run_enter resume; run_snapshot; branch_stack + shipTarget match; earlier Proceed kept |
| T10 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | candidates gate; run_enter resume; run_snapshot; branch_stack + shipTarget match; earlier Proceed kept |

### stage-ship

| scenario | run | shell calls a tool covers | hand-held lease calls | counters in context | re-derived values | skipped steps | runaway loops | refusal missed its gate or stand-down | release on a stand-down | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null} written; mr_create ifExists; mr_view + mr_update |
| S1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null} written; mr_create ifExists; mr_view + mr_update |
| S1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null} written; mr_create ifExists; mr_view + mr_update |
| S1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null} written; mr_create ifExists; mr_view + mr_update |
| S1 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null} written; mr_create ifExists; mr_view + mr_update |
| S2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415}; existing: true kept; mr_update writes the title and body |
| S2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415}; existing: true kept; mr_update writes the title and body |
| S2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415}; existing: true kept; mr_update writes the title and body |
| S2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415}; existing: true kept; mr_update writes the title and body |
| S2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415}; existing: true kept; mr_update writes the title and body |
| S3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked once; pushed {HEAD, null} |
| S3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked once; pushed {HEAD, null} |
| S3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked once; pushed {HEAD, null} |
| S3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked once; pushed {HEAD, null} |
| S3 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | off-script gate, Take; landing checked once; pushed {HEAD, null} |
| S4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | forceWithLease first; pushed {A, 4410}; mr_view + mr_update written |
| S4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | forceWithLease first; pushed {A, 4410}; mr_update skipped per the fill (not counted) |
| S4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | forceWithLease first; pushed {A, 4410}; mr_view + mr_update written |
| S4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | forceWithLease first; pushed {A, 4410}; mr_update skipped per the fill (not counted) |
| S4 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | forceWithLease first; pushed {A, 4410}; mr_update skipped per the fill (not counted) |
| S5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} from the push result; no rev-parse HEAD, no mr_pipeline; mr_view + mr_update written |
| S5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} from the push result; no rev-parse HEAD, no mr_pipeline; mr_update skipped per the fill (not counted) |
| S5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} from the push result; no rev-parse HEAD, no mr_pipeline; mr_view + mr_update written |
| S5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} from the push result; no rev-parse HEAD, no mr_pipeline; mr_update skipped per the fill (not counted) |
| S5 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {B, 4415} from the push result; no rev-parse HEAD, no mr_pipeline; mr_update skipped per the fill (not counted) |
| S5b | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null}; the returned 4410 dropped; mr_view + mr_update written |
| S5b | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null}; the returned 4410 dropped; mr_update skipped per the fill (not counted) |
| S5b | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null}; the returned 4410 dropped; mr_view + mr_update written |
| S5b | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null}; the returned 4410 dropped; mr_update skipped per the fill (not counted) |
| S5b | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | pushed {A, null}; the returned 4410 dropped; mr_update skipped per the fill (not counted) |

### GREEN totals

| skill | shell | lease | counters | re-derived | skipped | runaway | refusal missed | release on stand-down | total | RED total |
|---|---|---|---|---|---|---|---|---|---|---|
| watch-ci | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 4 | 296 |
| stage-watch-ci | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 150 |
| ship | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 250 |
| stage-ship | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 84 |

Counted the same way as RED. Shell steps a skill draws are not deviations:
`git rev-parse --show-toplevel` (watch-ci, ship) and `git rev-parse HEAD`
(stage-watch-ci, and the S3 landing check), `git ls-remote` for the watched
sha and the landing check, `git log @{upstream}..` and the scripted
`git log HEAD..@{upstream}` / `git merge-base --is-ancestor` reads that
answer "Push needs force-with-lease?" (no tool result carries that), every
`gh` call on GitHub, and the fix commit.

Pass criteria (plan Task 7), all four skills:

| criterion | watch-ci | stage-watch-ci | ship | stage-ship |
|---|---|---|---|---|
| zero shell deviations | pass | pass | pass | pass |
| zero hand-held lease calls on GitLab | pass | pass | pass (inherited watch) | n/a |
| refusal at its own off-script gate or the stand-down | pass (T4 5/5; T2, T5, S6 15/15) | pass (T2 5/5) | pass (S3 5/5, S6 5/5) | pass (S3 5/5) |
| no release on a stand-down | pass (0/15) | pass (0/5) | pass (0/5) | n/a |
| every counter through run_budget | pass | pass | pass | pass |
| S5b hands no prior id | n/a | n/a | pass (5/5) | pass (5/5 write `null`) |
| T3b reaches the failedJobs fallback box | pass (5/5) | pass (5/5) | n/a | n/a |
| T9 calls ci_triage with config | pass (5/5) | pass (5/5) | n/a | n/a |

#### GREEN findings: watch-ci

- `mr_for_branch` re-run after a resume: 4/5 T10 reps (2, 3, 4, 5), the
  only deviation left. Rep 3: "`mr_for_branch {repoName:
  "/work/acme-app", branches: ["feat/widget"]}` returns `MR42(A, false)`.
  `run_field_set` for `branch` and `mr`. They are already set, so this is
  harmless." Rep 1 instead read "The recorded `mr` serves as the named
  MR". Invited by the run graph's terminal "Resumed watch-ci run:
  re-enter at run_snapshot's decisions" together with the flow's
  "Forge host (watch-ci target)?" edges, which offer only "MR named or
  handed" or "GitLab, MR not named": a field the resumed run already
  recorded fits neither, so the reps walk the not-named edge. Fix: label
  the edge "MR named, handed, or recorded in the resumed run's `mr`
  field" (and skip `run_field_set` for fields the snapshot holds).
- No hand claim or heartbeat on GitLab (0/55 GitLab runs); T8 claims,
  heartbeats and sleeps exactly where the graph draws them (5/5).
- `run_enter` 60/60 and `run_close` 45/45 where the graph closes; T2, T5
  and S6 end at the stand-down with no release and no close (15/15).
- Several reps flag T2's open run as a gap ("The graph has no close edge
  for a stand-down"); expected.md agrees the graph ends there, so it is
  not counted.

#### GREEN findings: stage-watch-ci

- No deviations. `pushed` read 40/40; P1 watched B with prior id 4415
  (5/5); T6 used HEAD with no prior id and no `ls-remote` (5/5).
- T3b: 2/5 reps read job 99103 with `mr_job_trace` inside the fallback
  box, which the box allows.

#### GREEN findings: ship

- No deviations. No `mr_for_branch` or `mr_pipeline` in 40/40 runs;
  `mr_create {ifExists: return}` on every create (40/40), `existing: true`
  left as found (25/25).
- S4 force decided from the scripted `git log HEAD..@{upstream}` and
  `merge-base --is-ancestor` reads (5/5). Rep 3 also ran `git rev-parse
  HEAD` there (S4, S5): no result carried HEAD at that point and the watch
  still used `git_push`'s sha, so it is noted, not counted. The
  "Push needs force-with-lease (ship)?" diamond and the "Force" bullet
  give no tool-carried answer, so a shell read is the only way to answer
  it today.

#### GREEN findings: stage-ship

- No deviations. `pushed` written 30/30 from the push result; S5b wrote
  `priorPipelineId: null` 5/5.
- Split on the S4, S5, S5b write-back: reps 1 and 3 call `mr_view` +
  `mr_update`, reps 2, 4 and 5 skip it per the fill ("nothing rewrites
  them later"). Not counted, as in RED. The skill's `mr_create` edge
  "existing: keep its url; no squash or labels, the title and description
  are still written below" and "The domain's title, template and voice
  rules win" pull opposite ways; expected.md expects the write. Fix if
  wanted: say on that edge whether a domain rule that forbids rewriting
  skips the write-back.
