---
node: report_no_mr
---

# Report that no open MR has this branch as its source

A null entry from `mr_for_branch`: report that no open MR has that branch
as its source, and stop. An `mr_for_branch` or `mr_threads` error is never
"no open MR" or "no threads": quote it unedited, and the stage
fails with it as the reason.
