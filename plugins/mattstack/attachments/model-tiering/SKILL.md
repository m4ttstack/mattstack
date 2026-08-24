---
name: model-tiering
description: "Use when choosing which model to spawn a sub-agent, worker, or sub-claude on -- any decision point where a less capable model could handle the work. Covers spawn-time selection (shepherd picking worker models) and delegation-time selection (a worker dispatching sub-agents for subtasks)."
metadata:
  provides: "model-tiering@1"
---

# Model Tiering

Use the least capable model tier **and effort** that can succeed at each unit
of work. An omitted model flag inherits the parent's model -- usually the most
expensive one -- which silently defeats tiering.

## The tier table

Tiers are **aliases**, not model IDs. Aliases point to the provider's
recommended version and update over time, so the table survives model
releases; resolution is provider-dependent (Bedrock, Foundry, and Google
Cloud resolve `opus` and `sonnet` differently from the first-party API). A
rejected alias exits 1 at launch -- a bad entry is a visible failure, not a
silent downgrade.

| Work shape | Tier |
|---|---|
| Transcription plus testing (the plan carries the literal code), or a single-file mechanical fix | `haiku` |
| Mechanical execution -- complete spec, 2-3 files, existing pattern to follow | `sonnet` |
| Design / triage -- multiple valid approaches, cross-layer, product decisions | `opus` |
| Long-horizon autonomous work -- larger than one sitting | `fable` |
| Integration -- merge branches, run verification, report | `sonnet` |
| Review -- disposable artifact or diff reviewer | `sonnet` |
| Simple, high-volume, or disposable lookup | `haiku` |

**Cost floor.** Cheapest models take 2-3x the turns on multi-step work and
cost more overall. `sonnet` is the floor for reviewers and for prose
implementers. `haiku` is only for work where the input already contains the
answer: transcription plus testing, single-file mechanical fixes, simple lookups.

**Excluded aliases.** `opusplan` upgrades only inside Claude Code's plan
permission mode, which skill-driven workers never enter -- do not re-add it.
`best` and `default` resolve by org entitlement, not work shape. `[1m]`
variants pick a context window, not a tier; when used, quote them
(`'opus[1m]'`) -- brackets are zsh glob characters.

## Two dispatch surfaces

| | Spawn-time (`claude` CLI) | Delegation-time (Agent tool) |
|---|---|---|
| Model | alias or full ID | enum: `sonnet`, `opus`, `haiku`, `fable` |
| Effort | `--effort` flag | no effort parameter exists |
| `best` / `default` / `[1m]` | accepted | rejected |
| Billing account | selectable at launch | inherits the caller's session |

The four tier words are valid on both surfaces. Effort and account decisions
are spawn-time only; a delegation-time answer names a model and nothing
else.

## Effort (spawn-time only)

Use the model's **default** effort; deviate only for a named reason. Tuning
effort is often a better lever than switching models.

- Claude Code **clamps** an unsupported level to the highest supported level
  at or below it. No per-model matrix is needed, and models without effort
  support are a non-event.
- Organization effort caps clamp **silently** in background agents and JSON
  output modes; a pane may run below the requested level with no warning.
- `ultracode` is a Claude Code setting (xhigh plus workflow orchestration),
  not a level in the ladder.

## The two discriminators

- **Wrong conclusion despite full context** -> next tier up.
- **Right idea, sloppy execution** (skipped a file, did not run the tests,
  did not double-check) -> higher effort. Spawn-time only.

## Escalation

- Never retry a stuck agent **unchanged**.
- Missing context -> same tier, re-dispatched with the context.
- Wrong despite full context -> next tier up.

## Complexity signals

Use these to place a unit of work in the table:

- **File count and isolation.** A single file with the fix fully specified =
  cheapest tier. 2-3 files with a clear spec = mechanical. Multi-file with
  integration concerns = design tier.
- **Spec completeness.** Brief contains the exact code or precise
  instructions = mechanical. Brief describes intent and constraints = design
  tier.
- **Decision load.** Zero design decisions left = mechanical. Any product,
  architecture, or pattern decision = design tier.
- **Existing pattern.** Adding a field along an existing pattern, renaming,
  copy tweak = mechanical. New pattern, new component, new abstraction =
  design tier.

When in doubt, use the higher tier. A capable model on simple work wastes
money; a simple model on complex work wastes everything.

## Tiering is recursive

A design-tier agent that runs the superpowers chain (brainstorming, spec,
plan, implement) should in turn dispatch its implementer sub-agents on
cheaper models. The plan's task descriptions carry the complexity signals: a
task touching 1-2 files with complete code in the spec is mechanical; a task
requiring broad codebase understanding is design tier.

This recursion is how tiering saves the most: the expensive model does
judgment and orchestration; the cheap models do the volume work.

## Domain overrides

Skills layered on top of this one may set a floor ("never use model X in
this repo") or a default ("ticket-driven work defaults to Opus because
triage happens inside the worker"). Those overrides are domain-specific;
this skill is the generic framework they override.
