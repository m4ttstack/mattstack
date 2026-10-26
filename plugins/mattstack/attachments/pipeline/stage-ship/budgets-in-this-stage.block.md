---
order: 3
label: Budgets
---

# Budgets in this stage

Each `run_budget` counts one as its loop is entered and lasts the stage
attempt, through compaction and resume. Its `spent?` diamond is yes when
that call returns `exhausted: true` (`spent >= limit`: the count that
reaches `limit` takes yes). A failure quotes what it last saw (the error, the note, the
failing output or conflicted files, the origin URL and answer, the images
named, the refusal) as its reason.
