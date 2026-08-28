---
name: execution-strategy
description: "Use when deciding how a unit of work should be carried out before it is handed to an executor -- assigning a method to a dispatched worker or subagent, choosing between test-first, plan-driven, and full-design approaches, or writing a brief that must tell its executor which method to run."
metadata:
  provides: "execution-strategy@1"
---

# Execution Strategy

Given a unit of work and the surface it will execute on, name the method
the executor runs and the report contract that method produces. A brief
that names no method leaves its executor to improvise one.

## The five strategies

| Strategy | Executor runs |
|---|---|
| `trivial` | the change directly; no test, because there is no runtime behavior to test |
| `direct-tdd` | superpowers:test-driven-development inline: RED -> GREEN -> REFACTOR, failing test named before code |
| `resume` | the superpowers chain entered at the supplied artifact: spec in hand -> writing-plans onward; plan in hand -> subagent-driven-development |
| `superpowers` | the full chain: brainstorming -> spec -> writing-plans -> subagent-driven-development |
| `delegate` | triages against this table, picks one of the other four, runs it |

`delegate` never picks itself, must respect the surface table below, and
names its choice in its report so the dispatcher knows which report
contract applies.

Excluded: superpowers:executing-plans -- it defers to
subagent-driven-development wherever subagents are available, and
dispatched workers are full Claude Code sessions, so it is dominated.

## Picking the strategy

- `trivial` -- no runtime behavior to test: pure docs, comments, config,
  or a mechanical rename with zero logic change.
- `direct-tdd` -- real code with clear criteria and an existing pattern.
- `superpowers` -- everything else: new features, multiple valid
  approaches, vague criteria, cross-layer work, product decisions.
- `resume` -- a completed spec or plan is already supplied.
- `delegate` -- the dispatcher is not triaging; the executor triages
  against this section and picks one of the other four.

When in doubt between `direct-tdd` and `superpowers`, go `superpowers`;
between `trivial` and `direct-tdd`, go `direct-tdd`.

TDD is the floor, never a tier: any path that writes production code
writes its failing test first. `trivial` is the single escape hatch and it
is tight -- "it's simple", "it's small", or "I'll test after" is the
`direct-tdd` tell, not a `trivial` pass.

## Surface support

| Surface | `trivial` | `direct-tdd` | `resume` | `superpowers` | `delegate` |
|---|---|---|---|---|---|
| Pane worker with a question relay | yes | yes | yes | yes | yes |
| Agent-tool subagent | yes | yes | yes | **no** | yes |

`superpowers` starts with brainstorming, which needs a human in the loop
throughout; an Agent-tool subagent cannot stop and wait for one.

When the picking rules land on `superpowers` and the surface is an
Agent-tool subagent, the unit fails on this surface: report the conflict
to the dispatcher rather than recording a strategy the surface cannot
run (not `superpowers`-and-continue, not a downgraded tier to fit the
surface). Name the two re-dispatch paths in the report: a pane worker
with a question relay, or a supplied spec/plan that re-enters the work
as `resume`, which this surface supports.

## One plan, one executor

A plan is never sliced across parallel executors: it has one sequential
controller, its tasks chain by Consumes/Produces interfaces, and its
ledger is keyed by plan identity within one worktree. Fan out one level
up: 1 job = 1 sub-project = 1 spec = 1 plan = 1 branch = 1 worktree =
1 ledger.

## Report shape is per strategy

| Strategy | Report |
|---|---|
| `trivial`, `direct-tdd` | item-coded: one line per task item, plus verification results |
| `resume`, `superpowers` | milestone lines (`spec: <path>`, `plan: <path>`) as they land, then commit range and final-review verdict |
| `delegate` | the chosen strategy's shape, with the choice named first |

## Briefing an executor

Copy the assigned strategy's body from `${CLAUDE_SKILL_DIR}/references/strategies.md` verbatim
into the brief and fill its `<angle-bracket>` slots. Do not compose method
prose per job; the bodies carry the worker-boundary rules and the report
contract.
