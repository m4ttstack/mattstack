---
order: 6
props:
  rules:
    merge: add
    default: ""
---

# What the lanes graph cannot show

- **The two objective checks.** `herd_lanes {herd}` returns a row per active job (`commits`; `drift.files`, committed and uncommitted work since the merge base; `collidesWith`) plus herd-wide `collisions`. Compare each job's `drift.files` against its write fence yourself; no fence is stored. A job whose tree is gone has no row (it is in `skipped` with a reason), and the drift check skips it.
- **A report is a claim, not a merge.** Answer "Merged on the repo?" from the job's row `merge.state` (GitHub or GitLab) alone, never the report or a forge read of your own: `merged` is yes; `open`, `closed` or `none` is no; `unknown` goes to the off-script gate with the read's error. A lane with no row (a merge can dispose its tree) goes there with its `skipped` reason, and the proposed move closes the lane once the user confirms the merge. The row's `unmergedReports` feeds `Unmerged reports for this lane spent?` (see **Budgets**).
- **Job state is the daemon's.** It marks a job `done` when its report is published.
- **The integration job.** Its brief merges or cherry-picks the job branches, runs full verification, carries the shipping conventions, and reports. The first is `integration-1`; a lane that joined after it spawned gets the next number, and that brief covers only the lanes no integration job has merged.
- **Domain hook: after the report.** Unbound: the integration job merges. A bound domain part may define what follows a report (the worker ships through its own skill chain, or the shepherd merges after a gate; how jobs feeding one deliverable integrate) and whether it waits for the user to ask. Fixing and pushing stay with workers.
- **Domain hook: wrap-up.** Unbound: as drawn. A bound domain part may state its own tree lifecycle (trees that dispose themselves on merge, what a disposal refusal means); follow it over the defaults here.

{{props.rules}}
