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
