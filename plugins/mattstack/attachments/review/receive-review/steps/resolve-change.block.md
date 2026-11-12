---
node: resolve_change
---

# Resolve the change and record its identity

The change and its requirements come from the caller or domain adapter:
the diff range, plus the requirements it is judged against. Report a fetch
failure or a mismatched pair exactly as found; never fabricate the missing
half.

The MR or PR is `mrUrl`, or `repoName` plus `iid`; with neither,
`mr_for_branch` with `repoName` = this checkout and `branches: [<the
checked-out branch>]` gives the iid. Then record `mr` (the MR/PR URL; on
GitHub the PR's `webUrl`) and `branch` (its source branch) on whatever
run this is, keeping a field the run already records (an inherited run's
`mr` above all; read an inherited run's with `run_field_get {runDb, key}`,
an unset-key error meaning not recorded). `ticket` is recorded only on a
run this verb started or resumed, per Run identity.
