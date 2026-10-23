---
order: 3
label: Budgets
---

# Budgets in this stage

Each `run_budget` counts one as its loop is entered; a `<sha12>` key
counts per watched commit. Its `spent?` diamond is yes when that call
returns `exhausted: true` (`spent >= limit`: the count that
reaches `limit` takes yes).
`infra-retries` counts just before the retry it allows, so an unchosen
retry is never spent.
