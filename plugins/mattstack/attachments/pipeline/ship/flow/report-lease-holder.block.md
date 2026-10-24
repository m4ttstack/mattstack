---
node: report_lease_holder
---

# Report the CI lease holder and stand down (ship)

Another attendant holds the MR's CI lease, and the holder owns every
commit, push and retry on it: never push again, retry or release
anything; that lease is someone else's. Report the `holder` the refusal
names, and take the stood-down exit.
