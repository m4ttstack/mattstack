---
order: 6
props:
  rules:
    merge: add
    default: ""
---

# Domain rules

If a rule below asks for a move this graph marks STOP, take the off-script edge instead.

The domain supplies triage (how to read a red, REAL or INFRA, which jobs
block, noise, ownership), judged at `Classify the triage report
(watch-ci)`; it never retries, watches, claims, releases or pushes. This
skill runs no vendored script: a rule that runs `<scripts>/ci-triage.sh`
is the move `STOP: GitLab triage goes through ci_triage (watch-ci)`
redirects, so call `ci_triage` with `pipelineId: <N>` (never the ref's
newest pipeline); `<forge> jobs` goes to `pipeline_jobs`; `ci-attendant.sh`
or `ci-watch.sh` goes to `ci_watch`. `ci_triage` reads its REAL and
INFRA patterns, noisy jobs and base settings from the `ci.triage.*`
settings, on top of its built-in patterns, so a rule's `--config` flag
names no file to read. `config` carries only
what a rule states outright: `real-patterns`, `infra-patterns` and
`noisy-jobs` (string arrays) add to the settings; `base-depth`, `base-ref`
and `skip-base` replace them.

{{props.rules}}

Rules sit above or in a step's own section. Where no rule names a move,
the graph's other flows apply.
