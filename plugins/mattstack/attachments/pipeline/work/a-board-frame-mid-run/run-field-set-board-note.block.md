---
node: run_field_set_board_note
label: Set board note
---

# run_field_set {runDb, key: board-<the frame's iid>, value: <one-line note>, stage}

One line naming the MR and what you found: `!4127 red on pipeline
88120431: INFRA runner timeout, no code change`, `!4131 red on
pipeline 88120577: its own lint job, not this branch`, `!4127 red on
pipeline 88120431 after close opened: unfixed, Iterate to fix`, `!4131
red on pipeline 88120577: caused by this branch (unit-tests), unfixed:
Iterate back through implement`, or for a rebase frame `!4131 needs a rebase: a doctor
rebases it after this run`. `stage` is the position's stage (at close,
the last stage). Never rebase, push to or retry the stacked MR: it is
someone else's branch.
