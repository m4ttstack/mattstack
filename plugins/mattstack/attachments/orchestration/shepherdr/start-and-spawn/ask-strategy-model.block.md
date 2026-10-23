---
node: ask_strategy_model
kind: gate
props:
  rules:
    merge: add
    default: ""
---

# Ask the strategy and model per job

Strategy predicts the work shape, and the shape predicts the tier: one
choice. Recommend per job (strategy from the bound strategy table, model
from the tier table), then ask one AskUserQuestion per job (single choice,
up to 4 jobs per call): the recommendation first, marked "(Recommended)",
then 2-3 alternates across the tiers.

A half is fixed when every option would carry it: a completed plan
(`from-plan`) or spec (`from-spec`), or a domain pin. State it once in the
question ("Runtime job (6-task plan in hand, so from-plan): which model?")
and label only the open half ("opus" / "fable" / "sonnet"); with both
open, labels carry both ("superpowers, opus" / "direct-tdd, sonnet").

**Effort rides with the model, not as a question.** Take it from the tier
table's row, or its escalation rule on a respawn, unless the user names a
reason. Every `herd_spawn` passes `model` and `effort`, or it launches on
defaults and defeats tiering. A respawn inherits model, effort
and account from the job row; pass one only to change it.

**Domain hook -- model floor and strategy pin.** Unbound: both halves are
open. A bound domain part may set a model floor for a class of work and pin
the strategy (its method skill is the brief's Method); the recommendation
starts at the floor, the pin is a fixed half, and a spawn below the floor
is wrong.

{{props.rules}}
