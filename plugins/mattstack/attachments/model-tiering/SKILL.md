---
name: model-tiering
description: "Use when choosing which model to spawn a sub-agent, worker, or sub-claude on -- any decision point where a less capable model could handle the work. Covers spawn-time selection (shepherd picking worker models) and delegation-time selection (a worker dispatching sub-agents for subtasks)."
metadata:
  provides: "model-tiering@1"
---

# Model Tiering

Use the least capable model tier **and effort** that can succeed at each unit
of work. An omitted model inherits the parent's model -- usually the most
expensive one -- which silently defeats tiering.

## The tier table

Pick a tier by the work's shape; the harness section below turns the tier
into a model and effort this harness accepts.

| Work shape | Tier |
|---|---|
| Transcription plus testing (the plan carries the literal code), or a single-file mechanical fix | light |
| Mechanical execution -- complete spec, 2-3 files, existing pattern to follow | standard |
| Design / triage -- multiple valid approaches, cross-layer, product decisions | deep |
| Long-horizon autonomous work -- larger than one sitting | long-horizon |
| Integration -- merge branches, run verification, report | standard |
| Review -- disposable artifact or diff reviewer | standard |
| Simple, high-volume, or disposable lookup | light |

**Cost floor.** The light tier takes 2-3x the turns on multi-step work and
costs more overall. Standard is the floor for reviewers and for prose
implementers. Light is only for work where the input already contains the
answer: transcription plus testing, single-file mechanical fixes, simple
lookups.

## Models and effort on this harness

Every spawn and delegation sets its model and effort the way this section
says; a dispatch surface with no effort parameter runs at the model's
default effort.

{{harness:models}}

## Accounts

{{harness:accounts}}

## Effort

Use the model's **default** effort; deviate only for a named reason. Tuning
effort is often a better lever than switching models.

## The two discriminators

- **Wrong conclusion despite full context** -> next tier up.
- **Right idea, sloppy execution** (skipped a file, did not run the tests,
  did not double-check) -> higher effort, where the dispatch surface takes
  one.

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
this repo") or a default ("ticket-driven work defaults to the deep tier
because triage happens inside the worker"). Those overrides are
domain-specific; this skill is the generic framework they override.
