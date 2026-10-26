---
order: 4
---

# What the watch loop cannot show

- **The push is transport.** A gate push is one line, `[gate] <id> is now open; re-read the gate registry.`, carrying only an id. Its arrival proves the daemon, the subscription and the herd; the `herd_gates` read is the verification, made first. `herd_gates` defaults to `HERD_ID` or the sole active herd and also returns open pipeline-run gates in a herd job's worktree. Room lines arrive the same way (`<job> #<n>: <body>` a report, `<job> #<n>: milestone: <artifact>` a milestone). A stale id or an unrelated room line is normal, never a reason to reach for another command or distrust the push.
- **Diagnosis and nudges.** `herd_diagnose {herd, job}` has the daemon read the pane and returns a verdict and budgets, never pane text. An `UNCONSUMED` gate in `herd_status`, or the watchdog's "answered Nm ago and unconsumed" line, is the arrival for a nudge; the nudge keys on the UNCONSUMED arrival's gate, never `lastGate.consumed`, which reads null for a gate the daemon does not track. `herd_nudge` sends a DM, then a typed line only into an idle pane with no form open, else `needsHuman`. No tool presses keys, and neither do you. A hidden (`bg:`) pane reaches the user only through `herd_attend {job, herd}`.
- **The disposable reviewer.** Its spawn is `herd_spawn {tree}` into the job's own tree (a guest if another job holds it; the tree stays the host's); the result's `reviewerRound` echoes the ticked budget. Its brief reads the artifact, DMs findings, and reports a verdict; the daemon closes its pane. You never read the artifact. It takes a per-spawn pick per the Accounts section.
- **A bare pane form.** A worker pane showing a structured question with no gate behind it (`herd_gates` returns nothing for it) is the banned bare pane-local form, unreachable from every channel. Flag it to the user; never answer it yourself. Covered panes deny it at source through the launch-injected gate-fork hook, so seeing one means the pane is uncovered or its daemon was unreachable.
- **Progress.** When the user asks for progress, and after a job's report while other jobs still run, show the view from mattstack:work-progress.

**Budgets.** The daemon counts; you decide. A `... spent?` diamond reads
`{used, cap, spent}` in this decision, before its move; a user's answer in
between does not stale it, since `respawns`, `nudges` and `reviewerRounds`
tick only on your own moves and a new notice is a new arrival with its own
read. `spent` (used >= cap) answers yes; no tool refuses on a spent
budget, so the diamond is the only guard.

| Budget | Read from | Before |
|---|---|---|
| `respawns` | `herd_diagnose` `budgets.respawns` | `herd_respawn` |
| `blockedNotices` | `herd_diagnose` `budgets.blockedNotices` | routing a blocked notice |
| `nudges[gate]` | `herd_diagnose` `budgets.nudges[<gate>]` (absent = unused) | `herd_nudge` |
| `reviewerRounds[artifact]` | `herd_diagnose` on the host job, `budgets.reviewerRounds[<artifact>]` (the milestone line's artifact; absent = unused) | the reviewer `herd_spawn` |
| `unmergedReports` | `herd_lanes` row's `unmergedReports` | the "measured merge state" DM |

**The respawn.** `herd_respawn {herd, job, brief?, model?, effort?, account?}` never
provisions, closes the old pane, relaunches in the job's tree on the stored
brief unless `brief` is new, and keeps the job's model, effort and account
unless passed. The old session's open and parked gates close as abandoned so the new
worker re-asks; answered ones are marked consumed.
