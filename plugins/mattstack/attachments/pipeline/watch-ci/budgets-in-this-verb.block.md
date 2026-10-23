---
order: 5
label: Budgets
---

# Budgets in this verb

Each `run_budget` counts one as its loop is entered. The `spent` diamond
after it is yes when that call returns `exhausted: true`
(`spent >= limit`: the count that
reaches `limit` takes yes). A key ending `<sha12>` counts per
watched commit; one with no `stage` counts run-wide, since a fix push
starts a new attempt mid-loop.
