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
into `review` by name, and this stage never fixes them. When the review's
Assessment carries an `Unanswered rules:` line, that line goes into
`review` as written, on any path that writes it. A Hold there
holds this stage too; an Abandon has already failed it, so nothing more is
written. The fix rounds (Review rounds = 3? and Fix each blocking finding test-first, commit) run only when no such gate ran.

{{props.rules}}
