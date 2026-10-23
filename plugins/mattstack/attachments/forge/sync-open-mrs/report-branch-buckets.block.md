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

## Starting the run

The `run_enter` nodes: `flags` is the compiled flag text below, verbatim;
`skillDir` is this skill's own directory; `stage` is `sync-open-mrs`;
`runDb` only when a caller handed one; add `spawnedBy` when a board or
another surface launched this pane.

{{run-start.flags:sync-open-mrs}}

Keep the result's `runDb` and pass it to every `run_*` call; nothing is
exported. The close is `run_close` only on a run this verb started or
resumed; `reason` on an abandoned close is the why, quoted when it is an
error.
