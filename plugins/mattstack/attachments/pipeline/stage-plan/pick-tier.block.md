---
node: pick_tier
props:
  rules:
    merge: add
    default: ""
---

# Pick the tier

**REQUIRED SUB-FLOW:** follow the strategy flow below to pick the tier.
The three tiers are its strategies of the same names; its other
strategies are not tiers of this stage. The domain may set a tier floor
(below, before the flow).

{{props.rules}}

{{include:execution-strategy}}
