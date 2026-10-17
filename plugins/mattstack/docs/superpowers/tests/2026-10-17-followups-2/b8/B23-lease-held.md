### Scenario B23

A repair push after a red CI. MR 42 is open at A; its head pipeline 4415
failed, and the watch-ci stage sent the run back here with one fix commit B
on top. Another session's doctor holds MR 42's CI lease.

1. `run_field_get {key: mr}` returns `{key: "mr", value: "<MR>"}`.
2. E1 to E6. `git log --oneline @{upstream}..` prints `8d2e4f6 fix widget count off by one`.
3. E7, E8.
4. `git_push` with `leaseMrUrl: "<MR>"` (with or without `setUpstream: true`) returns `{pushed: false, refused: "lease_held", holder: {mrUrl: "<MR>", owner: "session:other", holder: "doctor", branch: "feat/widget", heartbeatAt: 1792170300000, ttlSeconds: 600}}`. Without `leaseMrUrl` it returns `{pushed: true, branch: "feat/widget", sha: B, forceWithLease: false, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4415, mrLookup: "read", tree: "/work/acme-app"}`.
5. (if called) `ci_lease_read {mrUrl: "<MR>"}` returns `{lease: {mrUrl: "<MR>", owner: "session:other", holder: "doctor", branch: "feat/widget", heartbeatAt: 1792170300000, ttlSeconds: 600}, stale: false, mine: false}`.
6. (if opened) Any gate: the human answers `{action: "Hand back", next: "Proceed", note: null}`.
7. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`. E10, E11, E12.
