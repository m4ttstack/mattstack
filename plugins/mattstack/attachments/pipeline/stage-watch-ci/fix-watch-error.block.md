---
node: fix_watch_error
---

# Fix what the ci_watch error names

Correct what the error names (`mrUrl` the MR's https URL, `sha` 7 to 40 hex
characters, `priorPipelineId` the `N` of `gitlab:pipeline:N`) and call
again, once; an error naming no input (the repo not registered with rt,
`mr` on no known forge) gets one unchanged call.
