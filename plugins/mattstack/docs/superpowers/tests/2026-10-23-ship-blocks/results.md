# ship as a block tree: RED/GREEN

RED is `ship` compiled from the single `SKILL.md` before the conversion;
GREEN is `ship` compiled from its `*.block.md` tree. Both bind the same
`widgets` rules (two fast-check rules, two commit rules): RED in the v1
`domain` slot, which lands them in the `## Domain rules` section near the
end; GREEN as per-block values on `ship/flow/domain-fast-checks` and
`ship/flow/commit-named-files`, which lands each pair in its own step
section. The two compiled files are in `compiled/`.

Tool-less recipe: `bun build.ts <prompt dir>` writes each prompt (a header
from `headers/` plus that side's compiled ship); `bun run-reps.ts <prompt
dir> <empty dir> <red|green> <scenario...>` runs `claude --model sonnet
--tools ""` with no settings, hooks or slash commands from an empty
directory, 5 reps per scenario. Outputs are in `runs/`.

## ship-clean: a dirty tree, commit, checks pass, push, MR

| Question | RED | GREEN |
|---|---|---|
| MCP path | `run_enter`, `run_field_set`, `branch_stack`, `gate(ship)`, `run_field_set`, `git_push`, `mr_create`, `run_field_set`, `run_close` 5/5 | same 5/5 |
| fast checks at the checks step | `widgets:lint --changed`, then `widgets:typecheck`, after the commit 5/5 | same 5/5 |
| reverts the generated drift | `git checkout -- src/generated/gizmo-index.ts` 5/5 | same 5/5 |
| stages named files, `src/generated/` left out | 5/5 | 5/5 |
| subject `widgets(badge): <summary> [WID-123]` | 5/5 | 5/5 |
| runs a full suite | no 5/5 | no 5/5 |
| gates | `ship` (`dirty`, `open_as`, `next`) only 5/5 | same 5/5 |
| ends the run | `run_close {workType: ship, stage: ship, outcome: done}` 5/5 | same 5/5 |

## ship-checks-fail: the type check fails once, a fix round

| Question | RED | GREEN |
|---|---|---|
| MCP path | as ship-clean plus `run_budget` after the gate 5/5 | same 5/5 |
| fix round | edit the test, then the code, commit both by name, rerun lint and typecheck, revert drift 5/5 | same 5/5 |
| fix commit subject | `widgets(badge): fix ... [WID-123]` 5/5 | same 5/5 |
| `src/generated/` staged in any commit | 0/5 | 0/5 |
| runs a full suite | no 5/5 | no 5/5 |
| budget key, ship gate reopens | `ship:fix-rounds`, no 5/5 | same 5/5 |
| ends the run | `run_close {..., outcome: done}` 5/5 | same 5/5 |

## ship-push-refused: `git_push` refuses, Hold at the next gate

| Question | RED | GREEN |
|---|---|---|
| MCP path | ... `git_push`, `gate(off-script:ship:1)`, `run_hold` 5/5 | same 5/5 |
| checks and commit before the push | lint, typecheck, revert drift; named files, widgets subject 5/5 | same 5/5 |
| shell push or a `git_push` retry before the answer | no 5/5 | no 5/5 |
| gate after the refusal | `off-script:ship:1`, context quoting the refusal verbatim 5/5 | same 5/5 |
| the Hold | `run_hold {stage: ship, reason: off-script:ship:1, decidedBy}`, no `run_close` 5/5 | same 5/5 |

## Noise inside each side

- A second `run_field_set` before `branch_stack` (the ticket beside the
  branch): RED 2/5, 4/5, 1/5; GREEN 1/5, 1/5, 3/5 across the three
  scenarios. Both forms occur on both sides.
- ship-checks-fail line 2, a drift revert right after the failing check
  before the fix: RED 4/5, GREEN 3/5. Every rep on both sides reverts after
  the rerun.
- Commit summaries vary in wording on both sides; the widgets form holds
  in every rep.

## Verdict

GREEN makes the same decisions as RED in every row. No difference traces
to the conversion.

GREEN's `## Domain rules` section is empty under this binding and still
ends "When nothing is inlined above, the graph alone is the flow: ... no
fast checks". No GREEN rep read that as a reason to skip the checks (0/15),
but the sentence is wrong when a domain binds only step blocks.
