---
node: follow_domain_review
props:
  rules:
    merge: add
    default: ""
---

# Follow the domain review

The domain's own review pass, as it words it. When that pass asks the
human about its findings at a gate of its own (a self-review whose gate
offers Ship as is), the answer stands: the findings it leaves open go
into `review` by name, and this stage never fixes them. The fix rounds
below run only when no such gate ran.

{{props.rules}}
