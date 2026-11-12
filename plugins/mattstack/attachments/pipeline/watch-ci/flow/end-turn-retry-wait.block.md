---
node: end_turn_retry_wait
label: End turn and retry
---

# End the turn: waiting to retry (watch-ci)

The background `sleep 60` is running: end the turn here, in one line
naming the wait (`waiting to retry the job, wait <n>`). Run one
sleep task at a time and never sleep in the foreground. The task's finish
wakes the pane at `Trigger: the retry wait's sleep finished (watch-ci)`,
and `mr_retry` runs again for the jobs it refused.
