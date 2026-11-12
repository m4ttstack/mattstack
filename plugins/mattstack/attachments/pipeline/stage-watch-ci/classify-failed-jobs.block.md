---
node: classify_failed_jobs
---

# Classify each failure REAL or INFRA from failedJobs

`ci_triage` errored: quote it and classify `ci_watch`'s `failedJobs` as the
triage-report section says, ownership unknown, reading a job with no
`traceTail` (past the first five blocking) or a short or teardown-only
tail with `mr_job_trace`.

`failedJobs` lists same-project downstream jobs, so an empty list on a
`failed` pipeline likely means a cross-project one: read
`projects/:id/pipelines/<pipelineId>/bridges` with `gitlab_get`, its jobs,
then `projects/<downstream project id>/jobs/<jobId>/trace` (`mr_job_trace`
reads only this project). `gitlab_get` returns at most 256 KiB, so a log
whose end is out of reach stays UNCLEAR. Other pipelines come from
`pipeline_list`, a pipeline's jobs from `pipeline_jobs`.

The bridges read is GitLab's. On GitHub, read an empty `failedJobs` on
`failed` with `pipeline_jobs` (no `pipelineId`). Two kinds of GitHub
failure have no log, so each is UNCLEAR: a commit status, which comes with
`jobId` null, and a check another app reported, which keeps its numeric
`jobId` but gets no `traceTail`, and `mr_job_trace` errors on it.
