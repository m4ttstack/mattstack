# CI watch and triage on GitHub (RT-546)

## Why

`ci_watch`, `ci_triage`, `pipeline_jobs` and `rt ci watch` read GitLab only.
On a GitHub PR, `ci_watch` returns `unsupported_forge` (or the error "ci_watch
is GitLab only") and the stage skills fall back to a `gh pr checks` loop every
60 s with no failure classification, no check for failures inherited from the
target branch, no team triage rules and a fixed 45 minute stop. glance already
reads everything this needs on GitHub, and the daemon verbs the tools call
(`mr:get`, `mr:pipeline-failed-jobs`, `mr:fetch-job-trace`, `pipeline:list`,
`forge:get`) already answer on a GitHub repo.

## Goals (the RT-546 acceptance list)

- `ci_watch` follows a GitHub PR to a terminal state.
- `ci_triage` labels a GitHub failure REAL, INFRA or inherited.
- An optional red check (not required by branch protection) is not a failure.
- Team triage rules (`ci.triage.*`) reach the GitHub path.
- A GitHub watch stops at `ci.watch.budgetMinutes`.
- Added by the shepherd: `pipeline_jobs` works on GitHub.

## Non-goals

- RT-370 (waiting reasons, the skills' GitHub poll reading the setting).
- Any skill block. The stage skills keep their `unsupported_forge` branch; it
  goes dead once `ci_watch` answers on GitHub, and removing it is a follow-up
  for the skills lane.
- Merge queue (`merge_group`) runs. `mr_merge` already waits on the queue.
- Any change to glance, `lib/daemon/handlers/mr.ts` or the GitLab behaviour.

## Anti-goals

- More GitHub requests than today's `gh pr checks` loop at the default
  settings. Matt is cost-sensitive about GitHub request volume.
- A GitLab result that changes in any field.

## Standing rulings

Octokit and gitbeaker only; GitLab behaviour does not change; one forge per
team.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A (picked) | A GitHub adapter (`lib/ci/github-forge.ts`) that implements the existing `WatchDeps` reads and the `TriageForge` interface, so `watchPipeline` and `runTriage` stay one code path | Shares the lease, budget, watch state and settings code; the watch loop needs two small, GitLab-neutral changes and `runTriage` none |
| B | A separate GitHub watch loop and triage function | No risk to the GitLab loop, but duplicates the lease, budget and state logic and its tests |
| C | A daemon-side poller serving every watcher of a PR | Could share polls across sessions; a much larger daemon change |

The shepherd picked A.

## What a GitHub "pipeline" is

glance's PR fill returns one synthetic pipeline per PR: every check run and
commit status on the head sha (`statusCheckRollup`). Facts the design rests on:

- Each job's `allowFailure` is `!isRequired`. The pipeline's aggregate status
  counts only required checks, or every check when none is required.
- Job ids: `github:check:<id>` for a check run (for an Actions job this id is
  the Actions job id, so `mr:fetch-job-trace` and `mr_retry` take it) and
  `github:status:<context>` for a commit status (no log, no retry in rt).
- Pipeline id: `github:run:<n>` (the failed counted job's run, else the highest
  run id) or `github:checks:<pr url>` when no check has a workflow run. It moves
  as runs start, so it is not a stable identity.
- `createdAt` is always null; `sha` is the PR head; `ref` is the head branch;
  `mergeRequestEventType` is null; `webUrl` is `<pr>/checks`.
- A PR with no checks at all has a null pipeline.

## Design

### Forge detection

`ci_watch`, `ci_triage` and `pipeline_jobs` resolve their target with
`resolveMrTarget(input, { github: true })`; every daemon verb they call answers
on GitHub. The forge is GitHub when the first `mr:get` returns a web URL that
`parseMrUrl` does not read as a GitLab MR. The early `unsupported_forge`
returns, the "ci_watch is GitLab only" error and `unsupportedGithub` go away,
and so does `unsupported_forge` from `WatchState`.

### The GitHub head (shared by all three tools)

One helper in `lib/ci/github-forge.ts` turns the PR's `mr:get` pipeline into
the GitHub head the tools use. It rests on two per-commit reads, both through
`forge:get` (both paths pass its GitHub guard):

- **Required checks.** The PR target branch's required check names: the
  `required_status_checks` rules of `:repo/rules/branches/<target>` (rulesets)
  joined with `protection.required_status_checks.contexts` of
  `:repo/branches/<target>` (classic protection). glance's `isRequired` only
  covers checks already on the PR, so a required check that has not reported
  yet (this repo's final `checks` job, which `needs:` every other job, appears
  last) is invisible to it; the list closes that gap. A failed read of either
  is treated as an empty contribution from it, and a call where both fail
  falls back to glance's `isRequired`.
- **Anchor.** `pipeline:list {ref: <head branch>, sha: <head sha>, limit: 100}`
  lists the head sha's workflow runs on the PR's branch (the branch filter
  keeps an older run of the same sha on another branch out). The anchor is
  the earliest-created run: its id is the head's stable pipeline id
  (`github:run:<anchor id>`) and its `createdAt` the head's `createdAt`. A
  rerun keeps the run id, so the id is stable across retries.

Rules the head applies:

- **Blocking and status.** With a non-empty required list, a check blocks
  exactly when its name is on the list; the head's status is computed over
  the required names only (failed, else canceled, else running, else
  pending, else success), and a required name with no check on the PR yet
  makes it at least `pending`. With an empty list every check blocks and the
  head keeps glance's aggregate (glance already counts every check then). An
  optional red check therefore never blocks while a required list exists.
- **No early success.** A head that reads `success` is confirmed with one
  more `pipeline:list {ref, sha}` read: while any listed workflow run is not
  completed the head reads `running`. This catches a workflow whose later jobs
  have not been created yet. One REST read, only at a success.
- **External CI only.** The anchor read waits until a check on the head has a
  workflow run (glance's per-job `runId`). Until then, and for a head whose
  checks never have one, the head keeps glance's id and its `createdAt` is the
  first time the watch saw a check for the sha. Once a check with a run
  appears, the anchor is read (once) and replaces the fallback, so a fast
  external status that reports before the Actions run cannot fix the
  fallback in place.
- **A failed read** leaves that value unset for this poll (no anchor means
  the budget reads null), and the next poll retries it.

With `attend`, the required list and the anchor (or the first-seen fallback
time) persist in the watch state per sha, so they cost one read each per
commit. Without `attend`, one each per call.

### ci_watch on GitHub

The loop (`watchPipeline`) changes in two GitLab-neutral ways: a failed job
whose id is a GitHub commit status (`github:status:` prefix) is listed in
`failedJobs` with `jobId: null`, counts toward `blockingFailures` and gets no
trace; and `unsupported_forge` leaves `WatchState`. GitLab job ids are always
numeric `gitlab:job:` ids, so GitLab output is unchanged.

The GitHub `WatchDeps`:

- `readMr`: the same `mr:get`, mapped through the GitHub head (blocking,
  status, stable id, `createdAt`). The per-commit reads run on the first poll
  whose head sha matches the watched sha and has checks (the anchor waits for
  a check with a workflow run, as above).
- `failedJobs`: returns `[]` with no request. The head already lists every
  check; a per-run read would drop the required flag.
- `traceTail`: `mr:fetch-job-trace`, as on GitLab. A check from a non-Actions
  app has no log; the row then carries no `traceTail`.
- `commitParents`: never reached (no GitHub pipeline is a merge-ref pipeline).

With the stable id, the existing rules hold on GitHub: sha matching by the
head sha, `superseded` when the head moves, `no_pipeline` after 10 minutes with
no checks, the budget measured from the anchor's `createdAt`, `timeout` past
it, and a pipeline that last failed and runs again (a rerun keeps the anchor
id) reopening the window by itself. `priorPipelineId` and the merge-train rules
are GitLab only; on GitHub `priorPipelineId` is accepted and ignored.

**Poll interval (Matt's ruling).** On GitHub `intervalSeconds` defaults to 60
and must be 30 to 120; GitLab keeps default 30 and 10 to 120. The forge is
known only after the first read, so the range check for GitHub runs then, and
a value below 30 is an error naming the GitHub floor.

**Request cost per watched GitHub PR.** Each poll is one `mr:get`: one GraphQL
query (about 1 point; one more per extra 100 checks) and the branch-rules REST
read glance caches for 10 minutes (at most 6 an hour). At the 60 s default that
is about 60 GraphQL and 6 REST an hour, plus three REST reads per commit (the
two required-check reads and the anchor; per call without `attend`), one
confirmation read at a success and up to five log reads on a failure. Today's
`gh pr checks` loop costs about the same.

### ci_triage on GitHub

A `githubTriageForge(command, target, head)` implements `TriageForge`; settings
and inline config go through the same `settingsConfig` and `mergeConfig`, so
team triage rules reach GitHub unchanged.

- **Ids.** `runTriage` works on numbers. The head's number is its anchor
  run id, or 0 when the head has no Actions run (0 is never a run id, and
  the adapter reads 0 as the head). A base commit's number is the id of its
  newest run; the adapter keeps a map from that number to the commit's runs.
  A head job's `pipelineId` is its own run id.
- **Subject.** With no `pipelineId`, ci_triage triages the head. With
  `pipelineId` equal to the head's number, the same. With any other
  `pipelineId` (a workflow run id) it triages that run's failed jobs
  (`mr:pipeline-failed-jobs`); a job also on the head takes the head's
  blocking flag, any other job is blocking. `readPipelineSubject` returns the
  GitHub head instead of `{kind: "github"}`.
- **pipelineInfo.** The head's number, status, `<pr>/checks`, sha and ref, or
  for a run id one `forge:get :repo/actions/runs/<id>` read.
- **failedJobs.** For the head: its failed Actions check runs (a check with a
  workflow run) as jobs. Every other failed check (a commit status, or a
  check run another app reported) goes to `crossProject` with
  `downstream: null`, the existing slot for a failure rt cannot read a log
  for, so `allInfraBlocking` stays false while one blocks and no ownership is
  claimed for a check the base scan cannot see. For a base commit: one
  `mr:pipeline-failed-jobs` read per run of that commit whose status is
  failed; a green run costs no request.
- **Inherited.** `pipelinesForRef(ref, depth)` lists the base branch's
  workflow runs (`pipeline:list {ref, limit: 100}`, since `baseDepth` counts
  commits and each commit has one run per workflow), drops `schedule` runs
  (as GitLab drops scheduled pipelines), groups the rest by head sha, newest
  first, and returns up to `depth + 1` commits. One "base pipeline" is one
  base commit with all its workflows, matching a GitLab pipeline. A job is
  INHERITED when a job of the same name failed on a scanned base commit (an
  Actions check run's name is its job name).
- **trace.** `mr:fetch-job-trace`.
- **defaultBranch.** `forge:get :repo`'s `default_branch`.
- **infraPatterns.** GitHub runner failures on top of the shared defaults:
  `The runner has received a shutdown signal`, `lost communication with the
  server`, `The hosted runner encountered an error`, `exceeded the maximum
  execution time`.

A triage costs one `mr:get`, the head's per-commit reads (two required-check
reads and one anchor listing), one default-branch read, one listing per base
ref (at most two), one failed-jobs read per failed base run and one log read
per failed head job.

### pipeline_jobs on GitHub

With no `pipelineId` (or the head's number): the head's checks as job rows
(`jobId` the check id, or null for a commit status; `stage` "checks";
`attempt` 1; `blocking` from the head helper; `pipelineId` the job's run id,
else the head's number) and no bridges. With another `pipelineId` (a run id):
that run's jobs through `forge:get :repo/actions/runs/<id>/jobs`
(`filter=latest`, paged at 30 a page, halving the page size when the daemon
refuses an answer over its 256 KiB cap, as `readAllPages` does on GitLab),
`attempt` from the job's `run_attempt`, blocking as in triage. The REST
job's status and conclusion map to glance's status words through a helper in
`lib/ci/github-forge.ts` that mirrors glance's `checkStatusFromParts` (not
exported from the package). `scope` and `name` filter both.

### rt ci watch

No code path of its own: it runs the `ci_watch` tool, so it works on a PR URL
once the tool does. Its usage text and header comment stop saying MR only
where they do.

### Tool descriptions and the plugin

`ci_watch`, `ci_triage` and `pipeline_jobs` lose "GitLab only" and say what
GitHub does differently (the interval range, `jobId: null` for a commit
status, `priorPipelineId` ignored, crossProject for unreadable checks). That
regenerates `plugins/mattstack/attachments/mcp-tools/reference.md`, bumps the
plugin version one past main, recompiles, and the PR body carries an
engine-floor line.

## Testing

Unit tests only, with stubbed daemon commands (no live forge): GitHub watch to
success, to failed with an optional red check ignored, a required check not
yet reported keeping the head pending, an early success held by an
in-progress run, a commit status failure, budget timeout from the anchor, the
per-commit reads persisted and reused with `attend`, the external-CI fallback
and its upgrade when a run appears, the GitHub interval floor; GitHub triage
REAL/INFRA/INHERITED with team settings, base grouping by sha, crossProject for
commit statuses; `pipeline_jobs` on the head and on a run; every GitLab test
still green unchanged.

## Follow-ups outside the write fence

Reported in the PR, not edited here: `lib/command-tree-def.ts` (`rt ci watch`
hints say "MR URL" and "Seconds, 10 to 120"), `.claude/rules/mcp-and-gates.md`
(says `pipeline_jobs` is GitLab only and `ci_watch` reads GitLab), and the
stage skills' dead `unsupported_forge` branch.

## Left to the builder

- Exact wording of the tool descriptions (through `rt:ui-copy` rules).
- The watch-state field names and shape for the required list, the anchor
  and the first-seen fallback.
- Whether the GitHub interval check lives in the tool or the adapter.
