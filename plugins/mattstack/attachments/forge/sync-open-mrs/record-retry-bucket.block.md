---
node: record_retry_bucket
---

# Record the retry in its bucket

The retried tree's `branch_sync` result goes into its bucket by the table
under **Record the branch in its bucket**. A second `dirty-tree` is
skipped: dirty tree. A retry that returns "run git_pull first" is skipped
with the refusal quoted: the pull pass has already run.
