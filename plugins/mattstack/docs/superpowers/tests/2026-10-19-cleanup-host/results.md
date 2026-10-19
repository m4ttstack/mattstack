# cleanup-host: RED/GREEN

Tool-less recipe: `run-reps.sh <red|green> <scenario...>` runs
`claude --model sonnet --tools ""` with no settings, hooks or slash commands
from an empty directory, 5 reps per scenario. `build.py red e849a542d` builds
the RED prompts from the skill text before this change; `build.py green`
from the working tree. Each prompt is a header from `headers/` plus the host
SKILL.md with its includes inlined. Outputs are in `runs/`; `runs/round0/`
is the first GREEN, before the rule sentence named which count takes yes.

## H1: one budget convention (round counts unchanged)

| Scenario | Question | RED (old text) | GREEN round 0 | GREEN round 1 (final) |
|---|---|---|---|---|
| ship | edge out of `fix-rounds spent?` at spent 3 | no 5/5 | no 5/5 | no 5/5 |
| ship | failed check run that stops fixing | 4 5/5 | 4 5/5 | 4 5/5 |
| ship | landing-check failure that fails the stage | 2 5/5 | 2 5/5 | 2 5/5 |
| watch-ci | edge out of `waiting-results spent?` at spent 4 | no 5/5 | no 5/5 | no 5/5 |
| watch-ci | `waiting` result that opens the CI gate | 5 5/5 | 5 5/5 | 5 5/5 |
| watch-ci | GitHub pending poll that times out | 46 5/5 | 46 2/5, 47 3/5 | 46 5/5 |
| evidence | edge out of `capture-attempts spent?` at spent 2 | no 5/5 | no 5/5 | no 5/5 |
| evidence | failed capture that reopens the gate | 3 5/5 | 3 5/5 | 3 5/5 |
| evidence | confirm refusal that ends Not drawn | 2 5/5 | 2 5/5 | 2 5/5 |

Round 0's 47s were a prediction slip, not a runtime one: every rep took the
right edge from the returned `exhausted`, and a reasoning probe (3 reps)
corrected 47 to 46 once it did the arithmetic. Round 1 adds "the count that
reaches `limit` takes yes" to the rule sentence in all six hosts.

## H2: forge gates on the gate tools

Scenario: under a run, reach the gate, the human answers in the pane; list
the MCP calls up to the next tool.

| Scenario | RED: hand-written `run_field_set {key: gate}` or `run_decision` | GREEN: neither, `gate_ask`/`gate_answer` carry `runDb` and `stage` |
|---|---|---|
| rebase-worktree (Gate push) | 3/5 (2/5 skipped both: the text and the protocol disagreed) | 5/5 |
| checkout (Gate clarify: which branch) | 5/5 | 5/5 |

The checkout `branch` question is now marked `(write-in)`, since its text
promises their own branch name and `gate_answer` refuses text on a question
without `writeIn`. Rerun after that edit: 5/5 clean and 5/5 set `writeIn`
(the run before it is in `runs/round1/`).

Review nits: both clarify gates' `Selection` lines now name `next`, and
checkout's Hold calls `run_hold`, which writes the same `hold:<stage>:<attempt>`
record and `hold` field in one transaction. `checkout-hold` (the human picks
Hold, calls after `gate_answer`): RED (`build.py red 9c52fa8e9`) 5/5 hand-wrote
`run_decision` and `run_field_set {key: hold}`; GREEN 5/5 one `run_hold`. The
checkout gate rerun stays 5/5 clean with `writeIn` (the run before it is in
`runs/round2/`).

## Limits

| Key | Hosts | Old limit (spent > limit) | New limit (exhausted) | Yes on count | Rounds before yes |
|---|---|---|---|---|---|
| `evidence:doctor-reds` | browser-evidence | 1 | 2 | 2 | 1 |
| `evidence:sign-in-asks` | browser-evidence | 2 | 3 | 3 | 2 |
| `evidence:rerenders:<stem>` | browser-evidence | 2 | 3 | 3 | 2 |
| `evidence:redaction-openings:<stem>` | browser-evidence | 3 | 4 | 4 | 3 |
| `evidence:confirm-refusals:<stem>` | browser-evidence | 1 | 2 | 2 | 1 |
| `evidence:redaction-rounds:<stem>` | browser-evidence | 2 | 3 | 3 | 2 |
| `evidence:cover-rounds` | evidence-record | 3 | 4 | 4 | 3 |
| `evidence:record-retries` | evidence-record | 1 | 2 | 2 | 1 |
| `evidence:draw-failures:<case>/<slot>[/<theme>]` | evidence-record | 1 | 2 | 2 | 1 |
| `evidence:waiver-openings:<case>/<slot>[/<theme>]` | evidence-record | 2 | 3 | 3 | 2 |
| `evidence:upload-off-script` | evidence-record | 1 | 2 | 2 | 1 |
| `evidence:redaction-repairs:<stem>` | evidence-record | 1 | 2 | 2 | 1 |
| `ship:ship-gate-rounds` | ship, stage-ship | 1 | 2 | 2 | 1 |
| `ship:ship-gate-reopenings` | ship, stage-ship | 1 | 2 | 2 | 1 |
| `ship:fix-rounds` | ship, stage-ship | 3 | 4 | 4 | 3 |
| `ship:conflict-rounds` | ship, stage-ship | 3 | 4 | 4 | 3 |
| `ship:landing-checks` | ship, stage-ship | 1 | 2 | 2 | 1 |
| `ship:forge-clarify-rounds` | ship, stage-ship | 1 | 2 | 2 | 1 |
| `ship:mr-create-recalls` | ship, stage-ship | 1 | 2 | 2 | 1 |
| `ship:after-attempts:<case id>` | ship, stage-ship | 2 | 3 | 3 | 2 |
| `ship:mark-ready-rounds` | ship | 1 | 2 | 2 | 1 |
| `evidence:capture-attempts:<case>` | stage-evidence | 2 | 3 | 3 | 2 |
| `evidence:source-off-script` | stage-evidence | 1 | 2 | 2 | 1 |
| `evidence:gate-iterates` | stage-evidence | 2 | 3 | 3 | 2 |
| `watch-ci:waiting-results:<sha12>` | stage-watch-ci, watch-ci | 4 | 5 | 5 | 4 |
| `watch-ci:ci-watch-errors:<sha12>` | stage-watch-ci, watch-ci | 1 | 2 | 2 | 1 |
| `watch-ci:ci-watch-off-script` | stage-watch-ci, watch-ci | 1 | 2 | 2 | 1 |
| `watch-ci:github-claim-errors` | stage-watch-ci, watch-ci | 1 | 2 | 2 | 1 |
| `watch-ci:github-claim-off-script` | stage-watch-ci, watch-ci | 1 | 2 | 2 | 1 |
| `watch-ci:github-polls:<sha12>` | stage-watch-ci, watch-ci | 45 | 46 | 46 | 45 |
| `watch-ci:github-sha-waits:<sha12>` | stage-watch-ci, watch-ci | 5 | 6 | 6 | 5 |
| `watch-ci:infra-retries:<sha12>` | stage-watch-ci, watch-ci | 1 | 2 | 2 | 1 |
| `watch-ci:retry-off-script` | stage-watch-ci, watch-ci | 1 | 2 | 2 | 1 |
| `watch-ci:ci-gate-iterations` | stage-watch-ci, watch-ci | 2 | 3 | 3 | 2 |
| `watch-ci:mark-ready-iterations` | stage-watch-ci, watch-ci | 1 | 2 | 2 | 1 |
| `watch-ci:fix-rounds` | watch-ci | 3 | 4 | 4 | 3 |

## H5 and H6: static checks

- H5: no host's `allowed-tools` pre-allows a retired script
  (`grep -rn "scripts/ci-" plugins/mattstack/attachments/*/*/SKILL.md`
  frontmatter): the work engine's two rules were the only ones.
- H6: `dead-paths.sh` lists the files watch-ci and stage-watch-ci name
  under their own skill dir, each a compile warning with no forge binding.
  RED: both hosts named `parts/forge/scripts/ci-forge.sh`. GREEN: none. The `<scripts>` directory stays named (a directory never warns): `compile-native.e2e.test.ts` pins the default stage's rendered `{{stage.dir}}/scripts/`, and a forge-bound copy gets its `ci-forge.sh` path from the binding's own text. The
  redirect sentences a fill's old script call meets are unchanged, so no
  agent scenario was run for it.
