---
node: classify_triage_report
props:
  rules:
    merge: add
    default: ""
---

# Classify the triage report (watch-ci)

`ci_triage` sorts failed jobs into REAL, INFRA or UNCLEAR by their logs and
marks each blocking one `yours`, INHERITED (also failing on the target
branch) or UNKNOWN (no base to compare); the `blocking` list decides the
verdict. Read each UNCLEAR job with `mr_job_trace`: the tail, then `grep`
for the failure text or `headLines` when it sits far above the end; a
teardown-only tail (cleanup, artifact upload, runner exit) says nothing
about the cause. Read a `crossProject` entry as the failedJobs section says.
Then each blocking failure is REAL (the change broke it: a test, type or
lint failure in touched code), INFRA (unrelated: a runner, network or
dependency outage, a known flake) or, still UNCLEAR after the read, the
gate's.

No failure is classified before its log is read; an unreadable trace is
UNCLEAR, never INFRA. Domain rules judge the report and may move a job
between REAL and INFRA. INHERITED goes to the gate named as INHERITED,
never retried or fixed here; UNKNOWN still gets its one INFRA retry. This
box only classifies: INFRA job ids go to `mr_retry`; never run a retry
command a report prints.

{{props.rules}}
