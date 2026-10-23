---
node: reopened_recapture
---

# Reopened for a re-capture (ship)?

Yes when the run graph reopened the shipped run for the operator's new
AFTER. Nothing to push is a clean tree and an empty `git log
@{upstream}..`: the MR already carries HEAD, so the flow goes straight to
the AFTER with no gate, no `git_push` and no `mr_create`. The operator's
ask is the attach consent and covers the title and description write
after it, `mrUrl` is the run's `mr`, and the capture's `page:` is on HEAD.
The run is running again, so a hold is `run_hold` and the end is
`run_close`. A re-capture's failure still closes `done`, its reason in the
report: the MR shipped, and only a done run reopens for the next try.
Anything to push takes the usual route.
