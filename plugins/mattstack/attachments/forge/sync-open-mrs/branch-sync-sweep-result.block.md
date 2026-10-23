---
node: branch_sync_sweep_result
---

# branch_sync_sweep result?

**results**: the call returned `{repoName, results, noTree, complete}`.
**error**: the call itself failed (it could not list). On error, take the
per-branch loop over the selected rows (the map already listed them) and
put the sweep's error in the report.
