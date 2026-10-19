# shipped-recapture: RED/GREEN

Tool-less recipe: `run-reps.sh <red|green> <scenario...>` runs
`claude --model sonnet --tools ""` with no settings, hooks or slash commands
from an empty directory, 5 reps per scenario. `build.py red 94c5227e0`
builds the RED prompts from the skill text before this change; `build.py
green` from the working tree. Each prompt is a header from `headers/` plus
the host SKILL.md with its includes inlined. Outputs are in `runs/`.

## RT-504: a route from "already shipped, MR exists" to the AFTER

| Scenario | Host | Question | RED | GREEN |
|---|---|---|---|---|
| stage-recapture | stage-ship | reopened ship on a shipped run, nothing to push: calls `git_push` / `mr_create` | yes/yes 5/5 | no/no 5/5 |
| stage-recapture | stage-ship | path | push, create, then capture, record, attach | capture, `evidence_record`, `evidence_attach`, `mr_view`, `mr_update` 5/5 |
| ship-recapture | ship | standalone, asked for a new AFTER on a done run: `git_push` / `mr_create` | no/no 5/5 (via the revise path) | no/no 5/5 |
| ship-recapture | ship | a Hold at the redaction gate: recorded by | none, run closed 5/5 | `run_hold`, accepted 5/5 |
| ship-recapture | ship | the call that ends the run | none 5/5 | `run_close {workType: ship, stage: ship, outcome: done}` 5/5 |
| ship-recapture | ship | first call | `run_list` 5/5 | `run_stage {action: start, stage: ship, reopen: true}` 5/5 |
| work-recapture | work | first run calls | `run_list`, `run_enter {fresh: true}` 5/5 | `run_stage {..., reopen: true}`, `run_enter {resume: r9}` 5/5 |
| work-recapture | work | starts a fresh run | yes 5/5 | no 5/5 |

RED standalone ship already avoided the push, but only by taking the
board-revision path for a new capture: nothing could hold and nothing
closed. RED work started a fresh run (r9 is finished) and walked the whole
pipeline from provision.

## Controls: an unshipped run's flow is unchanged

| Scenario | Host | Question | RED | GREEN |
|---|---|---|---|---|
| stage-unshipped | stage-ship | first ship, two commits, no `mr`: `git_push` / `mr_create` | yes/yes 5/5 | yes/yes 5/5 |
| stage-repair | stage-ship | `mr` set, a fix commit to push after red CI: `git_push` / `mr_create` | yes/yes 5/5 | yes/yes 5/5 |

The call sequences match RED rep for rep, bar one GREEN repair rep that
left `branch_stack` out of its list.

## RT-505 (engine)

The re-capture routes rely on `run_stage start` with `reopen: true` setting
a done run running again, so `run_hold`, `run_next`, `run_resolve` and
`run_close` work on it; covered by unit tests in `lib/runs/__tests__/` and
`lib/mcp/__tests__/run-tools.test.ts`, not by these scenarios.
