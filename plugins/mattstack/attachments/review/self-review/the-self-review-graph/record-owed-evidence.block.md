---
node: record_owed_evidence
---

# Record the owed evidence

Make no change. Write one line naming what to capture and where (the view,
the state, the commit it must show) and the finding id. It is owed, not
left open: in a work run the stage adds it to the run's `owed-evidence`
list and ship captures it before it finishes. Outside a run, list it in
the final message as owed evidence to capture once the branch is pushed.
