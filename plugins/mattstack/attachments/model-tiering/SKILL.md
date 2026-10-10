---
name: model-tiering
description: "Use when choosing which model and effort to run a sub-agent, worker, or sub-claude on, or when deciding whether to hand a piece of work to one at all -- spawn-time selection (shepherd picking worker models) and delegation-time selection (a worker dispatching sub-agents for subtasks)."
metadata:
  provides: "model-tiering@1"
---

# Model Tiering

Start from `opus` and tune **effort** first; change tier only when the work
shape calls for it. On Anthropic's published cost-per-task measurements, the
stronger model at lower effort usually beats a weaker model at higher effort,
and `fable` earns its price only where `opus` at higher effort still falls
short. An omitted model flag inherits the parent's model and an omitted effort
inherits the harness default, so every spawn names both.

## Delegate or do it inline

A sub-agent starts cold: tens of thousands of tokens of system prompt and
tools before it reads anything, then it re-gathers the context you already
hold. Your own context is cached and cheap to reread. Do the work inline
unless one of these holds:

- **Reading you do not need**: many files skimmed or searched, where only the
  summary comes back.
- **Independent pieces in parallel**: work that splits cleanly and runs at the
  same time.
- **Long output or many sequential steps** on a model much cheaper than yours.

A small mechanical edit you already know how to make stays inline: you would
batch it in one step, and a hand-off costs more than it saves.

## The tier table

Tiers are **aliases**, not model IDs. Aliases point to the provider's
recommended version and update over time, so the table survives model
releases; resolution is provider-dependent (Bedrock, Foundry, and Google
Cloud resolve `opus` and `sonnet` differently from the first-party API). A
rejected alias exits 1 at launch -- a bad entry is a visible failure, not a
silent downgrade.

| Work shape | Tier | Effort |
|---|---|---|
| Simple, high-volume, or disposable lookup; extraction; transcription plus testing (the brief carries the literal code) | `haiku` | `medium` |
| Mechanical execution -- complete spec, 2-3 files, existing pattern to follow | `sonnet` | `low` |
| Integration -- merge branches, run verification, report | `sonnet` | `low` |
| Re-review of a small fix whose finding is known | `sonnet` | `medium` |
| Reading-heavy fan-out where each worker returns a judgment (an assessment, not a list) | `sonnet` | `medium` |
| First review of a small, low-risk diff -- mechanical, one concern, under about 100 lines | `sonnet` | `high` |
| Design / triage -- multiple valid approaches, cross-layer, product decisions | `opus` | `medium` |
| Review of a normal feature diff or MR | `opus` | `high` |
| Long-horizon autonomous coding -- larger than one sitting | `opus` | `xhigh` |
| Review of a large or risky change -- concurrency, security, auth, money, data migrations, cross-cutting -- or a final whole-branch review | `opus` | `xhigh` |
| Escalation only -- `opus` at `xhigh` reached a wrong conclusion with full context, or the user asks for it | `fable` | `high` |

When two rows fit, take the one further down the table: rows run from
cheapest to most capable.

**Floors.** `haiku` is only for work where the input already contains the
answer and the output is easy to check; on multi-step work it takes more
turns and costs more overall. A reviewer never runs on a weaker model than
the one that wrote the change under review (for a re-review, the fix): a
review exists to catch what the author missed.

**Other skills' tier words.** When another skill names a tier instead of a
model (superpowers says "cheap", "standard", "most capable"), read cheap as
`haiku`, standard as `sonnet`, and most capable as `opus`; `fable` stays
escalation-only. Take the effort from this table's row for the work.

**Excluded aliases.** `opusplan` upgrades only inside Claude Code's plan
permission mode, which skill-driven workers never enter -- do not re-add it.
`best` and `default` resolve by org entitlement, not work shape. `[1m]`
variants pick a context window, not a tier; when used, quote them
(`'opus[1m]'`) -- brackets are zsh glob characters.

## Two dispatch surfaces

| | Spawn-time (`claude` CLI, `herd_spawn`) | Delegation-time (Agent tool) |
|---|---|---|
| Model | alias or full ID | `model`: `sonnet`, `opus`, `haiku`, `fable` |
| Effort | `--effort` flag, `effort` on `herd_spawn` | `effort`: `low` to `max` (ignored for a fork) |
| `best` / `default` / `[1m]` | accepted | rejected |
| Billing account | selectable at launch | inherits the caller's session |

The Agent tool's `effort` is set when a skill asks for it; this skill asks:
pass the table's effort on every delegation, or the escalated effort on a
re-dispatch.

## Effort

Effort trades thoroughness against tokens within one model, and work shapes
respond differently:

- **Coding and long-horizon agentic work repay effort.** On `opus`, `low`
  scored about 8 points below `high` at about a third of the cost; `xhigh`
  added about 1.4 points at 2.5x the cost.
- **Research, lookups, and knowledge work mostly do not.** `medium` matched
  the default; `low` gave up 1-3 points for a third to a half off.
- **Checkable output**: keep the row's effort for the batch and re-run only
  the failures at `high`.
- `max` only when the user asks for it.

Claude Code **clamps** an unsupported level to the highest supported level at
or below it, and organization effort caps clamp **silently** in background
agents and JSON output modes. `ultracode` is a Claude Code setting (xhigh
plus workflow orchestration), not a level in the ladder.

## The two discriminators

- **Right idea, sloppy execution** (skipped a file, did not run the tests,
  did not double-check) -> higher effort, same tier.
- **Wrong conclusion despite full context** -> higher effort first; next tier
  up once the model's ladder is spent (`haiku` or `sonnet` at `high`, then
  `opus`; `opus` at `xhigh`, then `fable`).

## Escalation

- Never retry a stuck agent **unchanged**.
- Missing context -> same tier and effort, re-dispatched with the context.
- Wrong despite full context on `opus` -> one step up the ladder per wrong attempt,
  counted from the effort the last attempt named (from its table row's effort
  when it named none): `low` -> `medium` -> `high` -> `xhigh` -> `fable` at
  `high`. `max` is off the ladder: only when the user asks for it. A wrong
  `haiku` or `sonnet` attempt re-runs on the same model at `high`, then
  moves to `opus` at `medium` and climbs from there.

## Complexity signals

Use these to place a unit of work in the table:

- **File count and isolation.** A single file with the fix fully specified =
  do it inline or `haiku`. 2-3 files with a clear spec = mechanical. Multi-file
  with integration concerns = design.
- **Spec completeness.** Brief contains the exact code or precise
  instructions = mechanical. Brief describes intent and constraints = design.
- **Decision load.** Zero design decisions left = mechanical. Any product,
  architecture, or pattern decision = design.
- **Existing pattern.** Adding a field along an existing pattern, renaming,
  copy tweak = mechanical. New pattern, new component, new abstraction =
  design.

When in doubt, raise effort before raising the tier.

## Tiering is recursive

A design-tier agent that runs the superpowers chain (brainstorming, spec,
plan, implement) dispatches its implementer sub-agents by the same table. The
plan's task descriptions carry the complexity signals: a task touching 1-2
files with complete code in the spec is mechanical; a task requiring broad
codebase understanding is design.

## Domain overrides

Skills layered on top of this one may set a floor ("never use model X in
this repo"), a ceiling ("nothing above `opus` at `xhigh`"), or a default
("ticket-driven work defaults to Opus because triage happens inside the
worker"). Those overrides are domain-specific; this skill is the generic
framework they override.
