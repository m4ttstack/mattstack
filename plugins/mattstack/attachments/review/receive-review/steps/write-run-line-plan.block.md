---
node: write_run_line_plan
---

# Write the receive-review-run line into the handed --report

Before the hand-back, write one line `receive-review-run: <run id>`
(`run_enter`'s `runId`) into the handed `--report`, replacing any earlier
one; with no `--report`, write nothing. A fresh pane the board later hands
a decision to passes that id as `resume` and lands on this run, which
holds the stored gate source. The board never reads the line.
