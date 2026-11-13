---
node: classify_failed_jobs
---

# Classify each failure REAL or INFRA from failedJobs (watch-ci)

`ci_triage` errored: quote it and classify `ci_watch`'s `failedJobs` as the
triage-report section says, ownership unknown. Read a job with no
`traceTail` (past the first five blocking), or a tail too short or
teardown-only, with `mr_job_trace` here.

`failedJobs` already lists same-project downstream jobs, so an empty list on
a `failed` pipeline likely means a cross-project downstream pipeline: read
`projects/:id/pipelines/<pipelineId>/bridges` with `gitlab_get` for it, its
jobs, then the failed job's `projects/<downstream project id>/jobs/<jobId>/trace`
(`mr_job_trace` reads only this project). `gitlab_get` returns at most
256 KiB; a log whose end is out of reach is unreadable.
Other pipelines on the branch come from `pipeline_list`, a pipeline's jobs
from `pipeline_jobs`.

The bridges read is GitLab's. On GitHub, read an empty `failedJobs` on
`failed` with `pipeline_jobs` (no `pipelineId`). Two kinds of GitHub
failure have no log: a commit status, which comes with `jobId` null, and a
check another app reported, which keeps its numeric `jobId` but gets no
`traceTail`, and `mr_job_trace` errors on it. `ci_watch` returns both in
`failedJobs`, so either one blocks when its `failedJobs` row has
`allowFailure: false`: a blocking one is UNCLEAR as it stands, and one that
does not block is optional and never decides the verdict.
