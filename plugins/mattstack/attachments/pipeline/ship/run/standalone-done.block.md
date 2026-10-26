---
node: standalone_done
label: Standalone done
---

# A done standalone ship run (ship re-capture)?

Yes when `run_snapshot`'s run is `done`, its work type is `ship` and its
`mr` field is set. A pipeline run's ship stage reopens through the work
verb, so the no exit names it; a run that is not done is reported with its
status.
