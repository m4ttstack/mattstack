---
node: report_branch_buckets
---

# Report every branch in one bucket

One table, every branch from the map landing in exactly one
bucket: rebased, still unpushed (old and new sha + subject), pushed,
current (nothing to push), conflicted (needs-hands, with its files), push
failed (with reason), or skipped (with reason: dirty tree, a `refusal`, a
`git_pull` error, no worktree). Below it: a branch the sweep synced that
the map did not list, the sweep's error when the sweep fell to the
per-branch path, and the `complete: false` line when the sweep returned it.
When `mr_map` failed there is no table: the report is that one line, the
GitLab error quoted.
