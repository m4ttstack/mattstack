---
node: measure_running
---

# Measure what still runs

The stop calls cover every job in the dispose list or with a closing pane:
`repoName` is the herd's repo, `tree` the job's `tree` from `herd_status`
(a registry name, never a path). A null
tree (a job spawned in a given dir) is skipped unless that dir is an rt
tree; then pass that entry's
`name` from `rt_verb {args: ["worktree", "list", "--repo", "<the herd's repo>", "--json"]}`.
They run first: a disposed tree leaves rt's registry.

`not-held` means rt recorded no hold, not that nothing runs: a hold is
recorded only when a tree's MR merges or closes with a process inside, so a
normal tree answers `not-held` with its dev servers up. The call ends only
processes tied to a held tree; there is no general kill.

Measure before you say a job's servers stopped (`lsof -ti tcp:<port>` or
the endpoint lookup). Report a survivor as still running, never kill it by
hand, and anything unmeasured as "not verified".
