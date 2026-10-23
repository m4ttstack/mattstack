---
node: run_position
---

# Where is the run?

Read it from the run, not from memory: the position's stage and
`waiting-gate`. **watch-ci running, its lease held**: watch-ci is the
stage at the position and its `ci_watch` is attending. **Waiting at the
close gate**: watch-ci has finished (its lease released, ship already
pushed this attempt) and the armed gate is close. Nothing a fix commits
here would be pushed, so every frame, own or stacked, becomes a run note
for the human answering close, who can choose Iterate (back through
ship). **Any other stage** is everything else, watch-ci between pushes
included.
