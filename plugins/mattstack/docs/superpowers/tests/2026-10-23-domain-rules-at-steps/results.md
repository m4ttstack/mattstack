# Domain rules that sit at the steps: RED/GREEN

The `## Domain rules` block of ship, stage-ship, stage-evidence,
stage-provision, watch-ci and stage-watch-ci ended with a sentence that
read the whole flow off that block alone:

> When nothing is inlined above, the graph alone is the flow: no steps
> before the gate, no fast checks, no rebase, no AFTER beyond a browser
> case's, no CI watch.

Each of those engines also declares `rules` props on its step blocks, so
a pack can bind its rules there and leave Domain rules empty. The sentence
then says "no fast checks" while the fast-check step carries the pack's
checks. The new text (ship's form):

> Rules sit above or in a step's own section. A step no rule names runs as
> the graph alone draws it: no steps before the gate, no fast checks, no
> rebase, no AFTER beyond a browser case's, no CI watch.

The other five engines take the same first sentence; only ship runs reps.

Both sides compile ship from the block tree under the split binding:
`widgets:ship-domain-fast-checks-rules` on
`mattstack:ship/flow/domain-fast-checks` and
`widgets:ship-commit-named-files-rules` on
`mattstack:ship/flow/commit-named-files`, Domain rules unbound. RED is the
text before the change, GREEN after it; `compiled/` holds both, and they
differ only in that sentence. RED is a fresh run: today's RED compile is
not byte-identical to `2026-10-23-ship-blocks/compiled/green-ship.md`
(run-identity and browser-evidence have become block includes since), so
those runs were not reused.

The scenarios are that record's three headers, unchanged. Recipe as there:
`bun build.ts <prompt dir>` (it builds each side whose compiled file
exists), then `bun run-reps.ts <prompt dir> <empty dir> <red|green>
<scenario...>`, 5 tool-less Sonnet reps per scenario. Outputs are in
`runs/`.

## ship-clean

| Question | RED | GREEN |
|---|---|---|
| MCP path `run_enter` ... `gate(ship)`, `run_field_set`, `git_push`, `mr_create`, `run_field_set`, `run_close` | 5/5 | 5/5 |
| fast checks `widgets:lint --changed` then `widgets:typecheck` after the commit | 5/5 | 5/5 |
| reverts `src/generated/gizmo-index.ts` after the checks | 5/5 | 5/5 |
| stages the two badge files by name, `src/generated/` left out | 5/5 | 5/5 |
| subject `widgets(badge): <summary> [WID-123]` | 5/5 | 5/5 |
| runs a full suite | 0/5 | 0/5 |
| only gate `ship` (`dirty`, `open_as`, `next`) | 5/5 | 5/5 |
| `run_close {workType: ship, stage: ship, outcome: done}` | 5/5 | 5/5 |

## ship-checks-fail

| Question | RED | GREEN |
|---|---|---|
| MCP path as ship-clean plus `run_budget` after the gate | 5/5 | 5/5 |
| fix round: edit the test, then the code, commit both by name, rerun lint and typecheck, revert drift | 5/5 | 5/5 |
| fix subject `widgets(badge): fix ... [WID-123]` | 5/5 | 5/5 |
| `src/generated/` staged in any commit | 0/5 | 0/5 |
| runs a full suite | 0/5 | 0/5 |
| budget key `ship:fix-rounds`, ship gate not reopened | 5/5 | 5/5 |
| `run_close {..., outcome: done}` | 5/5 | 5/5 |

## ship-push-refused

| Question | RED | GREEN |
|---|---|---|
| MCP path ... `git_push`, `gate(off-script:ship:1)`, `run_hold` | 5/5 | 5/5 |
| lint, typecheck, drift revert; named files, widgets subject before the push | 5/5 | 5/5 |
| shell push or a `git_push` retry before the answer | 0/5 | 0/5 |
| gate `off-script:ship:1` quoting the refusal | 5/5 | 5/5 |
| `run_hold {stage: ship, reason: off-script:ship:1, decidedBy}`, no `run_close` | 5/5 | 5/5 |

## Noise inside each side

- A second `run_field_set` before `branch_stack`: RED 4/5, 4/5, 1/5;
  GREEN 4/5, 2/5, 2/5 (clean, checks-fail, push-refused). Both forms occur
  on both sides, as in the ship-blocks record.
- ship-checks-fail, a drift revert right after the failing check: RED 2/5,
  GREEN 2/5. Every rep reverts after the rerun.
- ship-checks-fail line 2 leaves out the first, failing typecheck: RED
  1/5 (rep 3), GREEN 0/5.

## Verdict

RED shows no failure: no rep on either side read the old sentence as a
reason to skip the step rules (0/15 each), matching the ship-blocks record.
The change makes the sentence true under a step-only binding; GREEN makes
the same decisions as RED in every row.
