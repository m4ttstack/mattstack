---
node: write_run_line
---

# Write the review-run line into the handed --report

Write one `review-run: <run id>` line (`run_enter`'s `runId`) into the
handed `--report`, replacing any earlier one; with no `--report`, nothing.
A fresh pane the board later hands a decision to resumes this run, and
its stored gate source, by that id. The board never reads the line.
