---
node: classify_triage_report
props:
  rules:
    merge: add
    default: ""
---

# Classify the triage report

`ci_triage` sorts failed jobs into REAL, INFRA or UNCLEAR by their logs and
marks each blocking one `yours`, INHERITED (failing on the target branch
too) or UNKNOWN (no base); the `blocking` list decides the verdict. Read
each UNCLEAR job with `mr_job_trace`: the tail, then `grep` or
`headLines`; a teardown-only tail (cleanup, artifact upload, runner exit)
says nothing. Read a `crossProject` entry as the failedJobs section says.
Each blocking failure is then REAL (the change broke it: a test, type or
lint failure in touched code), INFRA (unrelated: a runner, network or
dependency outage, a known flake) or, still UNCLEAR, the gate's.

No failure is classified before its log is read; an unreadable trace is
UNCLEAR, never INFRA. INHERITED goes to the gate, named, never retried or
fixed here; UNKNOWN still gets its one INFRA retry. This box only
classifies: no retry command a report prints is run.

{{props.rules}}
