# Asks to slots

| the ask is about | engine | slot | contract |
| --- | --- | --- | --- |
| getting a worktree, ticket lookup, branch shape | `mattstack:stage-provision` | `domain` | `provision-domain@1` |
| what a plan must commit to, tiers, extra APPROACH lines | `mattstack:stage-plan` | `domain` | `plan-domain@1` |
| checks for touched paths before implementation | `mattstack:stage-gates` | `domain` | `gates-domain@1` |
| what counts as evidence, before/after capture | `mattstack:stage-evidence` | `domain` | `evidence-domain@1` |
| own-branch review homework | `mattstack:stage-self-review` | `domain` | `self-review-domain@1` |
| MR preflight, description shape, labels | `mattstack:stage-ship` and `mattstack:ship` | `domain` | `ship-domain@1` |
| CI job names, retry rules, triage | `mattstack:stage-watch-ci` and `mattstack:watch-ci` | `domain` | `watch-ci-domain@1` |
| what reviewers check | `mattstack:review`, `mattstack:self-review`, `mattstack:receive-review` | `criteria` | `review-criteria@1` |
| how to answer review threads | `mattstack:receive-review` | `reply-rules` | `reply-rules@1` |
| fan-out rules for parallel agents | `mattstack:shepherdr` | `domain` | `shepherdr-domain@1` |

Every slot above is optional; an unbound slot renders as nothing. One fill
may be bound to more than one engine (ship's stage and door share one fill).
`mattstack:shepherdr` is the one engine with required slots, `tiering`
(`model-tiering@1`) and `strategy` (`execution-strategy@1`); bind both to
the mattstack fills before compiling a `shepherdr` door.
