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
offers Ship as is), that gate passes `reach: "worktree"`, and the answer
stands: the findings it leaves open go into `review` by name, and this
stage never fixes them. A judgment call's `Open:` bullet carries the
reviewer's one-line reason, which ship puts in the description's
follow-up section. The evidence it records as owed goes on the
`owed-evidence` list, never into `review` alone. The commits its fixes
made go into `commits`. When the review's Assessment carries an
`Unanswered rules:` line, that line goes into `review` as written
whenever this stage writes `review`. A `hold` there holds this stage too; an Abandon has already failed it, so nothing more is
written. The fix rounds (Review rounds = 3? and Fix each finding test-first, commit) run only when no such gate ran.

{{props.rules}}
