---
node: report_outcome
---

# Report the outcome

Zero unresolved human threads: say so. Otherwise say which replies posted
and which threads resolved (on GitLab from `posted`, `alreadyPosted`,
`resolved` and `alreadyResolved`), quoting any `writeErrors`; a caller
that owns the gates gets the same. Held threads are reported by Report the
held threads verbatim (GitHub: Hold the picked fix rows and report the
failure verbatim) instead.
