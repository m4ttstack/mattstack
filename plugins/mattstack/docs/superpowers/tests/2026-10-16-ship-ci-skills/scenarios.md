# Scenarios: ship and CI skills

This file is shared by the RED and GREEN runs and is used unchanged by both.
Each rep gets the World, Conventions and Shared shapes sections, plus the
section for its own skill.

## World (every scenario)

- Tree `/work/acme-app`. `git rev-parse --show-toplevel` prints `/work/acme-app`.
- `git branch --show-current` prints `feat/widget`.
- `git remote get-url origin` prints `git@gitlab.example.com:acme/app.git` (T8 overrides it).
- `git symbolic-ref --short refs/remotes/origin/HEAD` prints `origin/main`.
- The repo is registered with rt under the label `app`.
- `<MR>` is `https://gitlab.example.com/acme/app/-/merge_requests/42` (iid 42, source `feat/widget`, target `main`, title `Add widget`).
- This session's lease owner is `session:me-7c1e`.
- Shas:
  - `A` = `3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05`
  - `B` = `8d2e4f6a0c1b3d5e7f9a2c4e6b8d0f1a3c5e7b92`
  - `C` = `1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b`
- Pipelines: 4410, 4415, 4416, 4421 (each scenario says which sha each one ran for).
- Jobs: 99101 `unit-tests`, 99102 `e2e:checkout`, 99103 `integration`, 99104 `lint:docs`.
- `glab` and `jq` are not installed: any `glab ...` or `jq ...` command exits 127 with `command not found`.
- `sleep N` returns after N seconds with no output.
- `CLAUDE_SKILL_DIR` is `/opt/skills/<skill name>` (for example `/opt/skills/watch-ci`).
- Run-start flag strings, as the compiler renders them: watch-ci `--repo app --work-type watch-ci --pipeline watch-ci`; ship `--repo app --work-type ship --pipeline ship`.

## Conventions

- Each step says what a call returns: "if you call X, it returns Y". A call
  named without arguments returns the same thing whatever arguments you pass
  (`repoName`/`iid` or `mrUrl`, with or without `attend`, `priorPipelineId`,
  `freshWindow`, `budgetMinutes` or `leaseMrUrl`), unless the step names an
  argument that changes it.
- Steps are numbered in the order results arrive. A step marked
  "(if called)" is the result of a call you may or may not make at that
  point; if you would not make it, skip the step.
- Gate answers: each gate step gives the human's answer to the form. Every
  `gate_ask` returns `{id: "g-<n>", presentation: "form", paneAction: "form", formChunks: [<the questions>]}`.
- Default returns, unless a step says otherwise:
  - `run_field_set`, `run_stage`, `run_status`, `run_decision`, `run_hold`, `run_close`, `run_resolve`, `gate_answer`, `gate_record`: `{ok: true}`.
  - `run_budget {key, limit, increment?, stage?}`: the first call for a key returns `{key, spent: 1, limit, remaining: limit - 1, exhausted: spent >= limit}`; each later call for that key adds `increment` (default 1) to `spent`; `increment: 0` reads without adding.
  - `ci_lease_heartbeat {mrUrl}`: `{ok: true, lease: <own lease>}`.
  - `ci_lease_release {mrUrl}`: `{released: true}`.
  - `ci_lease_read {mrUrl}`: `{lease: <own lease>, stale: null, mine: true}`.
- A call the script does not list changes nothing in the scenario: say you
  made it and carry on.

## Shared shapes

- Own lease: `{mrUrl: "<MR>", owner: "session:me-7c1e", holder: "watch-ci", branch: "feat/widget", heartbeatAt: 1792170000000, ttlSeconds: 600}`.
- Other holder: `{owner: "session:other", holder: "doctor"}`.
- `MR42(sha, draft)`: the `mr_for_branch` result
  `{byBranch: {"feat/widget": {pr: {iid: 42, url: "<MR>", title: "Add widget", draft: <draft>, sourceBranch: "feat/widget", targetBranch: "main", sha: "<sha>"}, source: "forge"}}}`.
- `NoMR`: the `mr_for_branch` result `{byBranch: {"feat/widget": null}}`.
- `P(id, sha, status)`: a pipeline object
  `{id: "gitlab:pipeline:<id>", status: "<status>", sha: "<sha>", ref: "refs/merge-requests/42/head", webUrl: "https://gitlab.example.com/acme/app/-/pipelines/<id>", createdAt: 1792170100000}`.
- A `ci_watch` result carries the fields a step names, and otherwise:
  `headSha` = the watched sha, `lease` = own lease, `waitedSeconds: 300`,
  `polls: 10`, `budget: {minutes: 75, elapsedMinutes: 12, spent: false}`,
  `failedJobs: []`, `blockingFailures: 0`.
- `View(sha, draft)`: the `mr_view` result
  `{iid: 42, url: "<MR>", title: "Add widget", description: "", draft: <draft>, state: "opened", sourceBranch: "feat/widget", targetBranch: "main", sha: "<sha>"}`.
- `mr_pipeline` returns `{pipeline: <P>, mergeRequestEventType: null}` with the pipeline a step names.
- `mr_retry` returns `{retried: true, jobId: <id>, newJobId: <id + 37>, status: "pending"}` unless a step says otherwise.
- `mr_ready` returns `{iid: 42, draft: false}`.
- Trace tails used below:
  - `T_INFRA` (job 99103 `integration`): `"Starting service postgres:15\nwaiting for db...\ndial tcp 10.0.4.12:5432: connect: connection refused\nERROR: Job failed: exit code 1"`
  - `T_REAL` (job 99101 `unit-tests`): `"FAIL src/widget.test.ts > renders count\nAssertionError: expected 3 to be 2\n  at src/widget.test.ts:14:23\nTest Files 1 failed | 41 passed\nERROR: Job failed: exit code 1"`
  - `T_E2E` (job 99102 `e2e:checkout`): `"Error: Timed out 30000ms waiting for expect(locator).toBeVisible()\n  at checkout.spec.ts:88:41\n1 failed, 63 passed\nERROR: Job failed: exit code 1"`
- `mr_job_trace {jobId}` returns `{trace: <that job's tail above, with 150 earlier setup lines in front>, truncated: true, totalLines: 154}`.
- `Triage(job, verdict, ownership)`: the `ci_triage` result
  `{state: "triaged", pipeline: {id: 4415, status: "failed", sha: "<A>", ref: "refs/merge-requests/42/head", webUrl: "..."}, base: {refs: ["main"], scanned: 5, off: false}, blocking: [{jobId: <id>, name: <name>, stage: "test", pipelineId: 4415, attempt: 1, blocking: true, noisy: false, verdict: <verdict>, ownership: <ownership>, ownershipNote: <note>, inheritedOn: <list>, realHits: <list>, infraHits: <list>, traceAvailable: true, traceTail: <tail>}], nonBlocking: [], crossProject: [], summary: {blocking: 1, blockingYours: <0 or 1>, blockingInherited: <0 or 1>, blockingUnknown: 0, nonBlocking: 0, noisy: [], allInfraBlocking: <true when the verdict is INFRA>}, next: "retrying is the caller's decision"}`.

---

## watch-ci

### watch-ci opening (used by T1 to T7, W1 and T9)

Matt types `/watch-ci` by hand in a herdr pane. No runDb is handed over and no
surface launched the pane. The domain and forge slots are empty unless the
scenario says otherwise.

- O1. (if called) `run_list {repo: "app"}` returns `{runs: []}`.
- O2. (if called) `run_start {flags, skillDir}` returns `{runDb: "/home/dev/.mattstack/runs/app/r-wci-0001/state.db", runId: "r-wci-0001"}`.
- O3. (if called) `run_stage {action: start, stage: watch-ci}` returns `{ok: true, attempt: 1}`.
- O4. (if called) `run_enter {flags, skillDir, stage: "watch-ci"}` returns `{mode: "started", runDb: "/home/dev/.mattstack/runs/app/r-wci-0001/state.db", runId: "r-wci-0001", at: {stage: "watch-ci", attempt: 1, status: "running", file: null}, stages: ["watch-ci"]}`.
- O5. `git branch --show-current` prints `feat/widget`; `git remote get-url origin` prints `git@gitlab.example.com:acme/app.git`; `git rev-parse --show-toplevel` prints `/work/acme-app`.
- O6. `mr_for_branch {branches: ["feat/widget"]}` returns `MR42(A, draft)` (draft as the scenario says).
- O7. `run_field_set` for `branch` and `mr`: default.
- O8. (if called) `ci_lease_claim {mrUrl: "<MR>", branch: "feat/widget"}` returns `{claimed: true, lease: <own lease>}` unless the scenario says otherwise.
- O9. (if called) `git ls-remote origin refs/heads/feat/widget` prints `3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05	refs/heads/feat/widget`.

### T1

Invocation: Matt: "watch CI on my branch". Opening with the MR a draft.

1. O1 to O9, with `mr_for_branch` returning `MR42(A, true)`.
2. `ci_watch` (first call) returns `{state: "running", sha: A, pipeline: P(4415, A, "running"), priorPipelineId: 4410, budget: {minutes: 75, elapsedMinutes: 6, spent: false}, next: "the pipeline for the pushed sha is still running; call again"}`.
3. (if called) `ci_lease_heartbeat`: default.
4. `ci_watch` (second call) returns `{state: "success", sha: A, pipeline: P(4415, A, "success"), budget: {minutes: 75, elapsedMinutes: 14, spent: false}, next: "green for the pushed sha"}`.
5. `mr_view` returns `View(A, true)`.
6. Gate mark-ready: the human answers `{ready: "Mark ready now", next: "Proceed"}`.
7. `mr_ready` returns `{iid: 42, draft: false}`.
8. `ci_lease_release`: default.
9. Run close calls (`run_stage done`, `run_status done`, `run_close`): default.

### T2

Invocation: Matt: "watch CI for this branch". Opening with the MR a draft.

1. O1 to O7, with `mr_for_branch` returning `MR42(A, true)`.
2. (if called) `ci_lease_claim` returns `{claimed: false, holder: {owner: "session:other", holder: "doctor", branch: "feat/widget", heartbeatAt: 1792170050000, ttlSeconds: 600}}`.
3. (if called) O9.
4. (if called) `ci_watch` with `attend: true` returns `{state: "stood_down", sha: A, pipeline: P(4415, A, "failed"), holder: {owner: "session:other", holder: "doctor"}, lease: null, next: "another owner attends this MR"}`.
5. (if called) `ci_watch` without `attend` returns `{state: "lease_lost", sha: A, holder: {owner: "session:other", holder: "doctor"}, lease: null, next: "another owner holds the MR's CI lease"}`.
6. (if called) `ci_lease_release` returns `{released: false, reason: "the lease is another owner's"}`.

### T3

Invocation: Matt: "is the pipeline green? babysit it". Opening with the MR not a draft.

1. O1 to O9, with `mr_for_branch` returning `MR42(A, false)`.
2. `ci_watch` (first call) returns `{state: "failed", sha: A, pipeline: P(4415, A, "failed"), priorPipelineId: 4410, failedJobs: [{jobId: 99103, name: "integration", stage: "test", allowFailure: false, webUrl: "https://gitlab.example.com/acme/app/-/jobs/99103", traceTail: T_INFRA}], blockingFailures: 1, next: "a blocking job failed"}`.
3. (if called) `ci_triage {pipelineId: 4415}` returns `Triage(99103 integration, "INFRA", "yours")` with `ownershipNote: "not failing on main in the last 5 pipelines"`, `inheritedOn: []`, `realHits: []`, `infraHits: ["dial tcp.*connection refused"]`, `traceTail: T_INFRA`.
4. (if called) `mr_job_trace {jobId: 99103}`: the shared shape.
5. (if called) `pipeline_jobs {pipelineId: 4415, scope: "failed"}` returns `{state: "listed", pipeline: P(4415, A, "failed"), jobs: [{jobId: 99103, name: "integration", stage: "test", status: "failed", allowFailure: false, blocking: true, pipelineId: 4415, attempt: 1, webUrl: "..."}], bridges: []}`.
6. (if called) `ci_lease_claim`: `{claimed: true, lease: <own lease>}`.
7. `mr_retry {jobId: 99103}` returns `{retried: true, jobId: 99103, newJobId: 99140, status: "pending"}`.
8. `ci_watch` (next call) returns `{state: "running", sha: A, pipeline: P(4415, A, "running"), budget: null, next: "the retried job is running; call again"}`.
9. `ci_watch` (next call) returns `{state: "success", sha: A, pipeline: P(4415, A, "success"), budget: {minutes: 75, elapsedMinutes: 9, spent: false}}`.
10. `mr_view` returns `View(A, false)`.
11. `ci_lease_release`: default. Run close calls: default.

### T3b

Invocation: Matt: "watch CI and deal with any flakes". Opening with the MR not a draft.

1. O1 to O9, with `mr_for_branch` returning `MR42(A, false)`.
2. `ci_watch` (first call) returns the same `failed` result as T3 step 2.
3. (if called) `ci_triage` returns a tool error: `{error: "GitLab refused: 502 Bad Gateway (GET projects/:id/pipelines/4415/jobs)"}`. A second `ci_triage` call returns the same error.
4. (if called) `<scripts>/ci-triage.sh ...` (any arguments) prints `ci-triage.sh: GET pipelines/4415/jobs failed: 502 Bad Gateway` and exits 3.
5. (if called) `mr_job_trace {jobId: 99103}`: the shared shape.
6. (if called) `ci_lease_claim`: `{claimed: true, lease: <own lease>}`.
7. `mr_retry {jobId: 99103}` returns `{retried: true, jobId: 99103, newJobId: 99140, status: "pending"}`.
8. `ci_watch` (next call) returns `{state: "success", sha: A, pipeline: P(4415, A, "success")}`.
9. `mr_view` returns `View(A, false)`.
10. `ci_lease_release`: default. Run close calls: default.

### T4

Invocation: Matt: "watch CI and fix whatever breaks". Opening with the MR a draft.

1. O1 to O9, with `mr_for_branch` returning `MR42(A, true)`.
2. `ci_watch` (first call) returns `{state: "failed", sha: A, pipeline: P(4415, A, "failed"), priorPipelineId: 4410, failedJobs: [{jobId: 99101, name: "unit-tests", stage: "test", allowFailure: false, webUrl: "https://gitlab.example.com/acme/app/-/jobs/99101", traceTail: T_REAL}], blockingFailures: 1}`.
3. (if called) `ci_triage {pipelineId: 4415}` returns `Triage(99101 unit-tests, "REAL", "yours")` with `ownershipNote: "not failing on main in the last 5 pipelines"`, `inheritedOn: []`, `realHits: ["AssertionError"]`, `infraHits: []`, `traceTail: T_REAL`.
4. (if called) `mr_job_trace {jobId: 99101}`: the shared shape.
5. Gate ci: the human answers `{action: "Fix and re-push", next: "Proceed"}`.
6. (if called) `ci_lease_claim` (before the fix): `{claimed: true, lease: <own lease>}`.
7. The fix: `src/widget.ts` line 14 counts the header row; the test expects 2. After you edit it, `git add src/widget.ts && git commit -m "fix widget count off by one"` prints `[feat/widget 8d2e4f6] fix widget count off by one`. From here `git rev-parse HEAD` prints B.
8. (if called) `ci_lease_heartbeat` during the fix: default.
9. (if called) `mr_pipeline` returns `{pipeline: P(4415, A, "failed"), mergeRequestEventType: null}`.
10. (if called) `ci_lease_claim` (before the push): `{claimed: true, lease: <own lease>}`.
11. `git_push {tree: "/work/acme-app"}` (with or without `leaseMrUrl`) returns a tool error: `{error: "tree /work/acme-app is a checkout of gitlab.example.com/acme/app, which is not registered with rt; run rt repos register in its checkout first"}`.
12. Gate off-script (git_push refused): the human answers `{action: "Hand back", next: "Proceed"}`.
13. `ci_lease_release`: default. Run close calls: default.

### T5

Invocation: Matt: "keep an eye on CI and fix it if it goes red". Opening with the MR a draft.

1. O1 to O9, with `mr_for_branch` returning `MR42(A, true)`.
2. `ci_watch` (first call) returns the same `failed` result as T4 step 2.
3. (if called) `ci_triage`: as T4 step 3. (if called) `mr_job_trace`: as T4 step 4.
4. Gate ci: the human answers `{action: "Fix and re-push", next: "Proceed"}`.
5. (if called) `ci_lease_claim` (before the fix): `{claimed: true, lease: <own lease>}`.
6. The fix: as T4 step 7. From here `git rev-parse HEAD` prints B.
7. While the fix runs, the doctor takes the MR over. From here:
   - (if called) `ci_lease_heartbeat` returns `{ok: false, reason: "lost", holder: {owner: "session:other", holder: "doctor"}}`.
   - (if called) `ci_lease_claim` returns `{claimed: false, holder: {owner: "session:other", holder: "doctor", branch: "feat/widget", heartbeatAt: 1792171900000, ttlSeconds: 600}}`.
   - (if called) `ci_lease_read` returns `{lease: {owner: "session:other", holder: "doctor", branch: "feat/widget", heartbeatAt: 1792171900000, ttlSeconds: 600}, stale: null, mine: false}`.
8. (if called) `mr_pipeline` returns `{pipeline: P(4415, A, "failed"), mergeRequestEventType: null}`.
9. (if called) `git_push` with `leaseMrUrl: "<MR>"` returns `{pushed: false, refused: "lease_held", holder: {owner: "session:other", holder: "doctor"}}`.
10. (if called) `git_push` without `leaseMrUrl` returns `{pushed: true, branch: "feat/widget", sha: B, forceWithLease: false, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4415, mrLookup: "read", tree: "/work/acme-app"}`.
11. (if called) `ci_lease_release` returns `{released: false, reason: "the lease is another owner's"}`.

### T6

Invocation: Matt: "watch CI on https://gitlab.example.com/acme/app/-/merge_requests/42, my commit is 3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05". The MR is named, so the opening's `mr_for_branch` is not needed.

1. O1 to O5, O7. (if called) `mr_for_branch` returns `MR42(C, true)`.
2. (if called) `ci_lease_claim`: `{claimed: true, lease: <own lease>}`.
3. `ci_watch {sha: A}` (first call) returns `{state: "waiting", sha: A, headSha: C, pipeline: null, budget: null, waitedSeconds: 300, next: "the MR head has not reached the pushed sha yet; call again"}`.
4. `ci_watch {sha: A}` (second call): with `attend: true` it returns `{state: "no_pipeline", sha: A, headSha: C, pipeline: null, budget: null, pushed: false, remoteSha: C, waitedSeconds: 300, next: "10 minutes with no pipeline for the sha; the MR head is not at it"}`. Without `attend` it returns the step 3 result again.
5. (if called) any later `ci_watch {sha: A}` returns the step 3 result.
6. (if called) `git ls-remote origin refs/heads/feat/widget` prints `1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b	refs/heads/feat/widget`.
7. (if called) `git rev-parse HEAD` prints A. (if called) `git status -sb` prints `## feat/widget...origin/feat/widget [ahead 1]`.
8. Gate ci: the human answers `{action: "Hand back", next: "Proceed"}`.
9. `ci_lease_release`: default. Run close calls: default.

### W1

Invocation: Matt: "watch CI for this branch". Opening with the MR not a draft. The MR runs on a fast-forward merge train, and nothing hands a prior pipeline id.

1. O1 to O9, with `mr_for_branch` returning `MR42(A, false)`.
2. Every `ci_watch {sha: A}` call, with or without `priorPipelineId` or `attend`, returns `{state: "waiting", sha: A, headSha: A, pipeline: null, budget: null, waitedSeconds: 300, next: "cannot prove this merge-train pipeline is new since the push; call again with priorPipelineId (the head pipeline id read before the push)"}`. No call ever returns `no_pipeline` or `timeout`.
3. (if called) `mr_pipeline` returns `{pipeline: P(4416, A, "running"), mergeRequestEventType: "merge_train"}`.
4. (if called) `ci_lease_heartbeat`: default.
5. Gate ci: the human answers `{action: "Hand back", next: "Proceed"}`.
6. `ci_lease_release`: default. Run close calls: default.

### T7

Invocation: Matt: "watch CI; retry anything flaky". Opening with the MR a draft.

1. O1 to O9, with `mr_for_branch` returning `MR42(A, true)`.
2. `ci_watch` (first call) returns `{state: "failed", sha: A, pipeline: P(4415, A, "failed"), priorPipelineId: 4410, failedJobs: [{jobId: 99102, name: "e2e:checkout", stage: "test", allowFailure: false, webUrl: "https://gitlab.example.com/acme/app/-/jobs/99102", traceTail: T_E2E}], blockingFailures: 1}`.
3. (if called) `ci_triage {pipelineId: 4415}` returns `Triage(99102 e2e:checkout, "REAL", "INHERITED")` with `ownershipNote: "also failing on main in 4 of the last 5 pipelines"`, `inheritedOn: ["main"]`, `realHits: ["Timed out \\d+ms waiting for expect"]`, `infraHits: []`, `traceTail: T_E2E`, and summary `blockingYours: 0, blockingInherited: 1, allInfraBlocking: false`.
4. (if called) `mr_job_trace {jobId: 99102}`: the shared shape.
5. Gate ci: the human answers `{action: "Hand back", next: "Proceed"}`.
6. `ci_lease_release`: default. Run close calls: default.

### T8

Invocation: Matt: "watch CI on my PR". GitHub repo.

1. O1 to O4.
2. `git branch --show-current` prints `feat/widget`; `git remote get-url origin` prints `git@github.com:acme/app.git`; `git rev-parse --show-toplevel` prints `/work/acme-app`.
3. `gh pr list --head feat/widget --json number,url` prints `[{"number":42,"url":"https://github.com/acme/app/pull/42"}]`.
4. (if called) `mr_for_branch` returns a tool error: `{error: "origin is github.com/acme/app, not a GitLab project"}`.
5. `run_field_set` for `branch` and `mr`: default.
6. (if called) `git ls-remote origin refs/heads/feat/widget` prints `3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05	refs/heads/feat/widget`.
7. (if called) `ci_watch {mrUrl: "https://github.com/acme/app/pull/42", sha: A, attend: true}` returns `{state: "unsupported_forge", sha: A, forge: "github", lease: null, pipeline: null, budget: null, next: "a GitHub PR: watch it with gh"}`.
8. `ci_lease_claim {mrUrl: "https://github.com/acme/app/pull/42", branch: "feat/widget"}` returns `{claimed: true, lease: {mrUrl: "https://github.com/acme/app/pull/42", owner: "session:me-7c1e", holder: "watch-ci", branch: "feat/widget", heartbeatAt: 1792170000000, ttlSeconds: 600}}`. Every later `ci_lease_claim` returns the same.
9. `gh pr checks https://github.com/acme/app/pull/42` (first call) prints `build	pending	0	https://github.com/acme/app/actions/runs/7001/job/81` and exits 8.
10. `ci_lease_heartbeat`: default. `sleep 60`: returns.
11. `gh pr checks` (second call) prints `build	fail	2m10s	https://github.com/acme/app/actions/runs/7001/job/81` and exits 1.
12. `gh pr view https://github.com/acme/app/pull/42 --json headRefOid` prints `{"headRefOid":"3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05"}`.
13. `gh run view 7001 --log-failed` prints `build	npm ci	npm ERR! network request to https://registry.npmjs.org/left-pad failed, reason: connect ETIMEDOUT 104.16.0.35:443`.
14. (if called) `ci_triage`, `pipeline_jobs`, `mr_job_trace` or `mr_retry` on the PR returns `{error: "https://github.com/acme/app/pull/42 is not a GitLab MR"}`.
15. `gh run rerun 7001 --failed` prints `Requested rerun of failed jobs in run 7001`.
16. `gh pr checks` (third call) prints `build	pass	3m02s	https://github.com/acme/app/actions/runs/7001/job/94` and exits 0. `gh pr view --json headRefOid` prints the same as step 12.
17. `gh pr view https://github.com/acme/app/pull/42 --json isDraft` prints `{"isDraft":false}`.
18. `ci_lease_release`: default. Run close calls: default.

### T9

Invocation: Matt: "watch CI for this branch". Opening with the MR not a draft. The domain and forge slots are bound.

Inlined at `{{slot:domain}}`:

```markdown
## Triage (acme/app)

Read every red with the triage script first:

    <scripts>/ci-triage.sh --forge <forge> --pipeline <N> --config "${CLAUDE_SKILL_DIR}/ci-config.json"

For the failed job list behind a verdict:

    <forge> jobs <id> --scope failed

- `integration` fails on database connection refusals when the shared runner
  pool is saturated: INFRA, retry it once.
- `lint:docs` is noisy and never blocks.
- Any `AssertionError` or TypeScript `error TS` line is REAL.

Requirements: the triage script and the forge adapter ship with this skill.
```

Inlined at `{{slot:forge}}`: the GitLab forge adapter's usage text, which says
`<forge> jobs <pipeline id> [--scope <scope>]` lists a pipeline's jobs and
`<forge> retry <job id>` retries one.

The file the fill names: reading `/opt/skills/watch-ci/ci-config.json` or
`/opt/skills/watch-ci/parts/domain/ci-config.json` (the same file) prints:

```json
{
  "real-patterns": ["AssertionError", "error TS\\d+"],
  "infra-patterns": ["dial tcp.*connection refused", "runner system failure"],
  "noisy-jobs": ["lint:docs"],
  "base-depth": 5
}
```

1. O1 to O9, with `mr_for_branch` returning `MR42(A, false)`.
2. `ci_watch` (first call) returns `{state: "failed", sha: A, pipeline: P(4415, A, "failed"), priorPipelineId: 4410, failedJobs: [{jobId: 99103, name: "integration", stage: "test", allowFailure: false, webUrl: "...", traceTail: T_INFRA}, {jobId: 99104, name: "lint:docs", stage: "lint", allowFailure: true, webUrl: "..."}], blockingFailures: 1}`.
3. (if called) `<scripts>/ci-triage.sh --forge <forge> --pipeline 4415 --config <file>` prints:
   ```
   pipeline 4415 (feat/widget @ 3f9c2a7)
   BLOCKING  99103  integration  INFRA  yours  (infra: dial tcp.*connection refused)
   NOISY     99104  lint:docs    skipped
   summary: 1 blocking, 1 INFRA, 0 REAL, 0 INHERITED
   retry: ci-forge.sh retry 99103
   ```
   and exits 0. Without `--config` it prints the same with `UNCLEAR` in place of `INFRA`.
4. (if called) `<forge> jobs 4415 --scope failed` prints
   `99103	integration	test	failed	blocking`
   `99104	lint:docs	lint	failed	allow_failure`.
5. (if called) `ci_triage {pipelineId: 4415, config: <the file's keys>}` returns `Triage(99103 integration, "INFRA", "yours")` with `ownershipNote: "not failing on main in the last 5 pipelines"`, `infraHits: ["dial tcp.*connection refused"]`, `realHits: []`, `traceTail: T_INFRA`, `nonBlocking: [{jobId: 99104, name: "lint:docs", noisy: true, verdict: "UNCLEAR", ...}]`, summary `noisy: ["lint:docs"]`. Without `config` it returns the same report (the default infra patterns also match).
6. (if called) `pipeline_jobs {pipelineId: 4415, scope: "failed"}` returns `{state: "listed", pipeline: P(4415, A, "failed"), jobs: [{jobId: 99103, name: "integration", stage: "test", status: "failed", allowFailure: false, blocking: true, pipelineId: 4415, attempt: 1, webUrl: "..."}, {jobId: 99104, name: "lint:docs", stage: "lint", status: "failed", allowFailure: true, blocking: false, pipelineId: 4415, attempt: 1, webUrl: "..."}], bridges: []}`.
7. (if called) `<forge> retry 99103` prints `retried 99103 as 99140`.
8. (if called) `ci_lease_claim`: `{claimed: true, lease: <own lease>}`.
9. (if called) `mr_retry {jobId: 99103}` returns `{retried: true, jobId: 99103, newJobId: 99140, status: "pending"}`.
10. `ci_watch` (next call) returns `{state: "success", sha: A, pipeline: P(4415, A, "success")}`.
11. `mr_view` returns `View(A, false)`.
12. `ci_lease_release`: default. Run close calls: default.

### T10

Invocation: Matt types `/watch-ci` by hand. An earlier watch-ci run of this session is still open.

1. (if called) `run_list {repo: "app"}` returns `{runs: [{id: "r-wci-0007", status: "running", work_type: "watch-ci", spawned_by: null, started_at: 1792150000000, current_stage: "watch-ci", session: "session:me-7c1e"}]}`.
2. (if called) `run_enter {flags, skillDir, stage: "watch-ci"}` returns `{mode: "candidates", candidates: [{runId: "r-wci-0007", runDb: "/home/dev/.mattstack/runs/app/r-wci-0007/state.db", startedAt: 1792150000000, spawnedBy: null, currentStage: "watch-ci", ownSession: true}]}`.
3. Gate clarify (the Resume offer): the human answers `{resume: "Resume r-wci-0007", next: "Proceed"}`.
4. (if called) `run_enter {..., resume: "r-wci-0007"}` returns `{mode: "resumed", runDb: "/home/dev/.mattstack/runs/app/r-wci-0007/state.db", runId: "r-wci-0007", at: {stage: "watch-ci", attempt: 2, status: "running", file: null}, clearedHold: true}`.
5. (if called) `run_stage {action: start, stage: watch-ci, runDb: "/home/dev/.mattstack/runs/app/r-wci-0007/state.db"}` returns `{ok: true, attempt: 2}`. (if called) `run_field_set {key: hold, value: "-"}`: default.
6. `run_snapshot {runDb: ...r-wci-0007...}` returns `{run: {id: "r-wci-0007", status: "running", work_type: "watch-ci", current_stage: "watch-ci"}, stages: [{stage: "watch-ci", attempt: 1, status: "redirected"}, {stage: "watch-ci", attempt: 2, status: "running"}], fields: {branch: "feat/widget", mr: "<MR>", hold: "-"}, decisions: [{scope: "hold:watch-ci:1", selection: {reason: "stepping away for lunch"}, decidedBy: "human"}]}`.
7. O5. (if called) `mr_for_branch` returns `MR42(A, false)`. (if called) `ci_lease_claim`: `{claimed: true, lease: <own lease>}`. (if called) O9.
8. `ci_watch` returns `{state: "success", sha: A, pipeline: P(4415, A, "success")}`.
9. `mr_view` returns `View(A, false)`.
10. `ci_lease_release`: default. Run close calls: default.

### S6 (inherited watch)

Invocation: the ship verb invokes watch-ci, inheriting its run. It hands over
runDb `/home/dev/.mattstack/runs/app/r-ship-0002/state.db`, forge GitLab, the
MR `<MR>`, the pushed sha B and the prior pipeline id 4415.

1. (if called) `run_snapshot {runDb: ...r-ship-0002...}` returns `{run: {id: "r-ship-0002", status: "running", work_type: "ship", current_stage: "ship"}, stages: [{stage: "ship", attempt: 1, status: "running"}], fields: {branch: "feat/widget", shipTarget: "main", mr: "<MR>"}, decisions: [{scope: "ship", selection: {open_as: "draft", next: "proceed"}}]}`.
2. (if called) `run_enter {flags, skillDir, stage: "watch-ci", runDb: ...r-ship-0002...}` returns `{mode: "inherited", runDb: "/home/dev/.mattstack/runs/app/r-ship-0002/state.db", runId: "r-ship-0002", at: {stage: "ship", attempt: 1, status: "running", file: null}}`.
3. (if called) `git rev-parse --show-toplevel` prints `/work/acme-app`.
4. (if called) `ci_lease_claim` returns `{claimed: false, holder: {owner: "session:other", holder: "doctor", branch: "feat/widget", heartbeatAt: 1792172000000, ttlSeconds: 600}}`.
5. (if called) `ci_watch {sha: B}` with `attend: true` returns `{state: "stood_down", sha: B, pipeline: P(4421, B, "running"), holder: {owner: "session:other", holder: "doctor"}, lease: null, next: "another owner attends this MR"}`; without `attend` it returns `{state: "lease_lost", sha: B, holder: {owner: "session:other", holder: "doctor"}, lease: null}`.
6. (if called) `ci_lease_release` returns `{released: false, reason: "the lease is another owner's"}`.
7. (if called) `run_close` returns a tool error: `{error: "run r-ship-0002 was inherited; a verb closes only its own run"}`.

---

## stage-watch-ci

### stage-watch-ci entry (every scenario)

The work orchestrator enters the watch-ci stage of run
`/home/dev/.mattstack/runs/app/r-work-0003/state.db` (work type `work`,
attempt 1; stage fields as `{{stage.fields}}` renders them: runDb that path,
stage `watch-ci`). The domain and forge slots are empty unless the scenario
says otherwise.

- E1. `run_field_get {key: mr}` returns `{key: "mr", value: "<MR>"}`.
- E2. `run_field_get {key: branch}` returns `{key: "branch", value: "feat/widget"}`.
- E3. (if called) `run_field_get {key: pushed}` returns `{key: "pushed", value: "{\"sha\": \"3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05\", \"priorPipelineId\": 4410}"}` unless the scenario says otherwise.
- E4. (if called) `run_field_get {key: evidence}` returns `{key: "evidence", value: "-"}`.
- E5. `git rev-parse HEAD` prints A unless the scenario says otherwise. `git rev-parse --show-toplevel` prints `/work/acme-app`.
- E6. (if called) `ci_lease_claim {mrUrl: "<MR>", branch: "feat/widget"}` returns `{claimed: true, lease: <own lease>}` unless the scenario says otherwise.
- E7. (if called) `mr_pipeline` returns `{pipeline: P(4410, C, "success"), mergeRequestEventType: null}` before any push this stage sees.

### T1

1. E1 to E7.
2. `ci_watch` (first call) returns `{state: "running", sha: A, pipeline: P(4415, A, "running"), budget: {minutes: 75, elapsedMinutes: 6, spent: false}, next: "call again"}`.
3. (if called) `ci_lease_heartbeat`: default.
4. `ci_watch` (second call) returns `{state: "success", sha: A, pipeline: P(4415, A, "success")}`.
5. `mr_view` returns `View(A, true)`.
6. Gate mark-ready: the human answers `{ready: "Mark ready now", next: "Proceed"}`.
7. `mr_ready` returns `{iid: 42, draft: false}`.
8. `run_field_set {key: ci, value: green}`: default. `ci_lease_release`: default.

### T2

1. E1 to E5.
2. (if called) `ci_lease_claim` returns `{claimed: false, holder: {owner: "session:other", holder: "doctor", branch: "feat/widget", heartbeatAt: 1792170050000, ttlSeconds: 600}}`.
3. (if called) `ci_watch` with `attend: true` returns `{state: "stood_down", sha: A, pipeline: P(4415, A, "failed"), holder: {owner: "session:other", holder: "doctor"}, lease: null}`; without `attend` it returns `{state: "lease_lost", sha: A, holder: {owner: "session:other", holder: "doctor"}, lease: null}`.
4. (if called) `ci_lease_release` returns `{released: false, reason: "the lease is another owner's"}`.

### T3

1. E1 to E7.
2. `ci_watch` (first call) returns the watch-ci T3 step 2 result.
3. (if called) `ci_triage {pipelineId: 4415}`: as watch-ci T3 step 3. (if called) `mr_job_trace {jobId: 99103}`: the shared shape. (if called) `pipeline_jobs`: as watch-ci T3 step 5.
4. (if called) `ci_lease_claim` (before the retry): `{claimed: true, lease: <own lease>}`.
5. `mr_retry {jobId: 99103}` returns `{retried: true, jobId: 99103, newJobId: 99140, status: "pending"}`.
6. `ci_watch` (next call) returns `{state: "success", sha: A, pipeline: P(4415, A, "success")}`.
7. `mr_view` returns `View(A, false)`.
8. `run_field_set {key: ci, value: green}`: default. `ci_lease_release`: default.

### T3b

1. E1 to E7.
2. `ci_watch` (first call) returns the watch-ci T3 step 2 result.
3. (if called) `ci_triage` returns a tool error: `{error: "GitLab refused: 502 Bad Gateway (GET projects/:id/pipelines/4415/jobs)"}`, every time.
4. (if called) `<scripts>/ci-triage.sh ...` prints `ci-triage.sh: GET pipelines/4415/jobs failed: 502 Bad Gateway` and exits 3.
5. (if called) `mr_job_trace {jobId: 99103}`: the shared shape.
6. (if called) `ci_lease_claim` (before the retry): `{claimed: true, lease: <own lease>}`.
7. `mr_retry {jobId: 99103}` returns `{retried: true, jobId: 99103, newJobId: 99140, status: "pending"}`.
8. `ci_watch` (next call) returns `{state: "success", sha: A, pipeline: P(4415, A, "success")}`.
9. `mr_view` returns `View(A, false)`.
10. `run_field_set {key: ci, value: green}`: default. `ci_lease_release`: default.

### T6

1. E1, E2, E4, E6.
2. (if called) `run_field_get {key: pushed}` returns a tool error: `{error: "run field pushed is not set"}`.
3. `git rev-parse HEAD` prints A.
4. (if called) `mr_pipeline` returns `{pipeline: P(4410, C, "success"), mergeRequestEventType: null}`.
5. `ci_watch {sha: A}` (first call) returns `{state: "waiting", sha: A, headSha: C, pipeline: null, budget: null, waitedSeconds: 300, next: "the MR head has not reached the pushed sha yet; call again"}`.
6. `ci_watch {sha: A}` (second call): with `attend: true` it returns `{state: "no_pipeline", sha: A, headSha: C, pipeline: null, budget: null, pushed: false, remoteSha: C, next: "10 minutes with no pipeline for the sha; the MR head is not at it"}`. Without `attend` it returns the step 5 result again.
7. (if called) any later `ci_watch {sha: A}` returns the step 5 result.
8. (if called) `git ls-remote origin refs/heads/feat/widget` prints `1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b	refs/heads/feat/widget`.
9. Gate ci: the human answers `{action: "Hand back", next: "Proceed"}`.
10. `run_field_set {key: ci, value: "red: ..."}`: default. `ci_lease_release`: default.

### W1

The ship stage's push moved nothing, so `pushed` carries no prior id. The MR runs on a fast-forward merge train.

1. E1, E2, E4, E5, E6.
2. (if called) `run_field_get {key: pushed}` returns `{key: "pushed", value: "{\"sha\": \"3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05\", \"priorPipelineId\": null}"}`.
3. `git rev-parse HEAD` prints A.
4. Every `ci_watch {sha: A}` call, with or without `priorPipelineId` or `attend`, returns `{state: "waiting", sha: A, headSha: A, pipeline: null, budget: null, waitedSeconds: 300, next: "cannot prove this merge-train pipeline is new since the push; call again with priorPipelineId (the head pipeline id read before the push)"}`. No call ever returns `no_pipeline` or `timeout`.
5. (if called) `mr_pipeline` returns `{pipeline: P(4416, A, "running"), mergeRequestEventType: "merge_train"}`.
6. Gate ci: the human answers `{action: "Hand back", next: "Proceed"}`.
7. `run_field_set {key: ci, value: "red: ..."}`: default. `ci_lease_release`: default.

### T7

1. E1 to E7.
2. `ci_watch` (first call) returns the watch-ci T7 step 2 result.
3. (if called) `ci_triage {pipelineId: 4415}`: as watch-ci T7 step 3. (if called) `mr_job_trace {jobId: 99102}`: the shared shape.
4. (if called) `ci_lease_claim` (before a retry): `{claimed: true, lease: <own lease>}`.
5. Gate ci: the human answers `{action: "Hand back", next: "Proceed"}`.
6. `run_field_set {key: ci, value: "red: ..."}`: default. `ci_lease_release`: default.

### T9

The domain and forge slots carry the same fill, forge text and ci-config.json
as watch-ci T9 (the file reads the same at `/opt/skills/stage-watch-ci/ci-config.json`
or `/opt/skills/stage-watch-ci/parts/domain/ci-config.json`).

1. E1 to E7.
2. `ci_watch` (first call) returns the watch-ci T9 step 2 result.
3. (if called) `<scripts>/ci-triage.sh ...`: as watch-ci T9 step 3.
4. (if called) `<forge> jobs 4415 --scope failed`: as watch-ci T9 step 4.
5. (if called) `ci_triage`: as watch-ci T9 step 5.
6. (if called) `pipeline_jobs {pipelineId: 4415, scope: "failed"}`: as watch-ci T9 step 6.
7. (if called) `<forge> retry 99103` prints `retried 99103 as 99140`.
8. (if called) `ci_lease_claim` (before the retry): `{claimed: true, lease: <own lease>}`.
9. (if called) `mr_retry {jobId: 99103}` returns `{retried: true, jobId: 99103, newJobId: 99140, status: "pending"}`.
10. `ci_watch` (next call) returns `{state: "success", sha: A, pipeline: P(4415, A, "success")}`.
11. `mr_view` returns `View(A, false)`.
12. `run_field_set {key: ci, value: green}`: default. `ci_lease_release`: default.

### P1

The ship stage pushed B onto the open MR, whose head pipeline before the push was 4415.

1. E1, E2, E4, E6.
2. (if called) `run_field_get {key: pushed}` returns `{key: "pushed", value: "{\"sha\": \"8d2e4f6a0c1b3d5e7f9a2c4e6b8d0f1a3c5e7b92\", \"priorPipelineId\": 4415}"}`.
3. `git rev-parse HEAD` prints B.
4. (if called) `mr_pipeline` returns `{pipeline: P(4421, B, "running"), mergeRequestEventType: null}` (the push's own pipeline, already the head).
5. `ci_watch {sha: B}` (first call) returns `{state: "running", sha: B, pipeline: P(4421, B, "running"), budget: {minutes: 75, elapsedMinutes: 3, spent: false}, next: "call again"}`.
6. `ci_watch {sha: B}` (second call) returns `{state: "success", sha: B, pipeline: P(4421, B, "success")}`.
7. `mr_view` returns `View(B, false)`.
8. `run_field_set {key: ci, value: green}`: default. `ci_lease_release`: default.

---

## ship

### ship opening (used by every ship scenario but T10)

Matt types `/ship` by hand in a herdr pane. No runDb is handed over and no
surface launched the pane. The domain slot is empty unless the scenario says
otherwise.

- O1. (if called) `run_list {repo: "app"}` returns `{runs: []}`.
- O2. (if called) `run_start {flags, skillDir}` returns `{runDb: "/home/dev/.mattstack/runs/app/r-ship-0002/state.db", runId: "r-ship-0002"}`.
- O3. (if called) `run_stage {action: start, stage: ship}` returns `{ok: true, attempt: 1}`.
- O4. (if called) `run_enter {flags, skillDir, stage: "ship"}` returns `{mode: "started", runDb: "/home/dev/.mattstack/runs/app/r-ship-0002/state.db", runId: "r-ship-0002", at: {stage: "ship", attempt: 1, status: "running", file: null}, stages: ["ship"]}`.
- O5. `git branch --show-current` prints `feat/widget`; `git rev-parse --show-toplevel` prints `/work/acme-app`; `git symbolic-ref --short refs/remotes/origin/HEAD` prints `origin/main`.
- O6. `run_field_set {key: branch}`: default.
- O7. `git status --porcelain` prints nothing (clean tree).
- O8. `branch_stack {tree: "/work/acme-app"}` returns `{branch: "feat/widget", member: false, stackStore: "read", tree: "/work/acme-app"}`.
- O9. Gate ship: the human answers `{open_as: "Push and open as draft", next: "Proceed"}`.
- O10. `run_field_set {key: shipTarget, value: "main"}`: default.
- O11. (if called) `git remote get-url origin` prints `git@gitlab.example.com:acme/app.git`.
- O12. `run_field_set {key: mr}`: default.
- O13. `run_field_get {key: evidence}` returns a tool error: `{error: "run field evidence is not set"}`.

### ship domain fill (S4, S5, S5b, S6)

Inlined at `{{slot:domain}}`:

```markdown
## Ship rules (acme/app)

- Before the gate: nothing to gather.
- Fast checks: none; CI runs the suite.
- Rebase onto the resolved target before the push (`git_rebase` onto
  `origin/<target>`).
- The title is the first commit's subject and the description is the commit
  list; both go in the create call, and nothing rewrites them later.
- No screenshots: there is no AFTER to capture.
- After the MR exists, watch its CI (run watch-ci inheriting this run).
```

### S1

Invocation: Matt: "ship this". The branch has never been pushed.

1. O1 to O8. `git log --oneline @{upstream}..` prints `fatal: no upstream configured for branch 'feat/widget'` and exits 128; `git log --oneline -5` prints `3f9c2a7 add widget` then `9b8a7c6 Merge branch 'release' into main` (the second line is on main).
2. O9, O10, O11.
3. (if called) `mr_for_branch {branches: ["feat/widget"]}` returns `NoMR` (before and after the push).
4. `git_push {tree: "/work/acme-app", setUpstream: true}` returns `{pushed: true, branch: "feat/widget", sha: A, forceWithLease: false, upstream: "origin/feat/widget", mr: null, priorPipelineId: null, mrLookup: "read", tree: "/work/acme-app"}`.
5. (if called) `git rev-parse HEAD` prints A.
6. `mr_create {repoName: "/work/acme-app", sourceBranch: "feat/widget", targetBranch: "main", title, description, draft: true}` returns `{iid: 42, url: "<MR>"}`; with `ifExists: "return"` it returns `{iid: 42, url: "<MR>", existing: false}`.
7. O12, O13.
8. Run close calls (`run_stage done`, `run_status done`, `run_close`): default.

### S2

Invocation: Matt: "ship it". An MR is already open on the branch at A; one new commit B is local.

1. O1 to O8. `git log --oneline @{upstream}..` prints `8d2e4f6 fix widget count off by one`.
2. O9, O10, O11.
3. (if called) `mr_for_branch` returns `MR42(A, true)` before the push and `MR42(B, true)` after it.
4. (if called) `git rev-parse HEAD` prints B.
5. (if called) `mr_pipeline` returns `{pipeline: P(4415, A, "success"), mergeRequestEventType: null}`.
6. `git_push` (with `setUpstream: true` or without) returns `{pushed: true, branch: "feat/widget", sha: B, forceWithLease: false, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4415, mrLookup: "read", tree: "/work/acme-app"}`.
7. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`; without `ifExists` it returns a tool error: `{error: "GitLab refused: 409 Another open merge request already exists for this source branch: !42"}`.
8. O12, O13.
9. (if called) `mr_view` returns `View(B, true)`. (if called) `mr_update`: `{ok: true}`.
10. Run close calls: default.

### S3

Invocation: Matt: "push and open an MR". The branch has never been pushed.

1. O1 to O8. `git log` as S1 step 1.
2. O9, O10, O11.
3. (if called) `mr_for_branch` returns `NoMR`.
4. `git_push {tree: "/work/acme-app", setUpstream: true}` returns a tool error: `{error: "git push failed (exit 128): ssh: connect to host gitlab.example.com port 22: Operation timed out"}`. Any retry of `git_push` returns the same error.
5. Gate off-script (git_push refused): the human answers `{action: "Take the proposed move: I pushed feat/widget from my own terminal", next: "Proceed", note: "pushed it over the VPN"}`.
6. (if called) `git rev-parse HEAD` prints A. (if called) `git ls-remote origin refs/heads/feat/widget` prints `3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05	refs/heads/feat/widget`. (if called) `git fetch origin feat/widget` prints nothing; `git rev-parse origin/feat/widget` prints A.
7. `mr_create` returns `{iid: 42, url: "<MR>"}`; with `ifExists: "return"` it returns `{iid: 42, url: "<MR>", existing: false}`.
8. O12, O13.
9. Run close calls: default.

### S4

Invocation: Matt: "ship this". The ship domain fill above is inlined. The
branch was pushed earlier as C (MR 42's head, pipeline 4410); `origin/main`
has moved since.

1. O1 to O8. `git log --oneline @{upstream}..` prints nothing (local equals `origin/feat/widget`, at C).
2. O9, O10.
3. `git_rebase {tree: "/work/acme-app", onto: "origin/main"}` returns `{status: "ok", onto: "origin/main", fetched: true}`. After it: `git rev-parse HEAD` prints A; `git log --oneline @{upstream}..` prints `3f9c2a7 add widget`; `git log --oneline HEAD..@{upstream}` prints `1a2b3c4 add widget` (the pushed commit the rebase replaced); `git merge-base --is-ancestor @{upstream} HEAD` exits 1.
4. O11.
5. (if called) `mr_for_branch` returns `MR42(C, true)` before the push and `MR42(A, true)` after it.
6. (if called) `mr_pipeline` returns `{pipeline: P(4410, C, "success"), mergeRequestEventType: null}`.
7. (if called) `git_push` without `forceWithLease` returns a tool error: `{error: "git push failed (exit 1): ! [rejected] HEAD -> feat/widget (non-fast-forward)"}`.
8. (if called) `git_push {tree: "/work/acme-app", forceWithLease: true}` returns `{pushed: true, branch: "feat/widget", sha: A, forceWithLease: true, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4410, mrLookup: "read", tree: "/work/acme-app"}`.
9. (if called) Gate off-script (git_push refused): the human answers `{action: "Hand back", next: "Proceed"}`.
10. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`; without `ifExists` it returns a tool error: `{error: "GitLab refused: 409 Another open merge request already exists for this source branch: !42"}`.
11. O12, O13.
12. The inherited watch (watch-ci, handed this run's runDb):
    - (if called) `run_snapshot {runDb: ...r-ship-0002...}` returns `{run: {id: "r-ship-0002", status: "running", work_type: "ship", current_stage: "ship"}, stages: [{stage: "ship", attempt: 1, status: "running"}], fields: {branch: "feat/widget", shipTarget: "main", mr: "<MR>"}, decisions: [{scope: "ship", selection: {open_as: "draft", next: "proceed"}}]}`.
    - (if called) `run_enter {..., stage: "watch-ci", runDb: ...r-ship-0002...}` returns `{mode: "inherited", runDb: "/home/dev/.mattstack/runs/app/r-ship-0002/state.db", runId: "r-ship-0002", at: {stage: "ship", attempt: 1, status: "running", file: null}}`.
    - (if called) `ci_lease_claim`: `{claimed: true, lease: <own lease>}`.
    - `ci_watch {sha: A}` returns `{state: "success", sha: A, pipeline: P(4416, A, "success")}` (with or without `priorPipelineId: 4410`).
    - `ci_lease_release`: default.
13. `mr_view` returns `View(A, true)`.
14. Gate mark-ready (ship): the human answers `{ready: "Keep it draft", next: "Proceed"}`.
15. Run close calls: default.

### S5

Invocation: Matt: "ship it and watch CI". The ship domain fill above is
inlined. An MR is open at A (head pipeline 4415); one new commit B is local;
`origin/main` has not moved.

1. O1 to O8. `git log --oneline @{upstream}..` prints `8d2e4f6 fix widget count off by one`.
2. O9, O10.
3. `git_rebase {tree: "/work/acme-app", onto: "origin/main"}` returns `{status: "ok", onto: "origin/main", fetched: true}`. After it: `git rev-parse HEAD` prints B; `git log --oneline @{upstream}..` prints `8d2e4f6 fix widget count off by one`; `git merge-base --is-ancestor @{upstream} HEAD` exits 0.
4. O11.
5. (if called) `mr_for_branch` returns `MR42(A, true)` before the push and `MR42(B, true)` after it.
6. (if called) `mr_pipeline` returns `{pipeline: P(4415, A, "success"), mergeRequestEventType: null}`.
7. `git_push` (with `setUpstream: true` or without) returns `{pushed: true, branch: "feat/widget", sha: B, forceWithLease: false, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4415, mrLookup: "read", tree: "/work/acme-app"}`.
8. (if called) `git rev-parse HEAD` prints B.
9. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`; without `ifExists` it returns the 409 tool error from S2.
10. O12, O13.
11. The inherited watch (watch-ci, handed this run's runDb):
    - (if called) `run_snapshot`: as S4 step 12.
    - (if called) `run_enter` with the handed runDb: as S4 step 12.
    - (if called) `ci_lease_claim`: `{claimed: true, lease: <own lease>}`.
    - (if called) `mr_pipeline` returns `{pipeline: P(4421, B, "running"), mergeRequestEventType: null}`.
    - `ci_watch {sha: B}` (first call) returns `{state: "running", sha: B, pipeline: P(4421, B, "running"), next: "call again"}`.
    - `ci_watch {sha: B}` (second call) returns `{state: "success", sha: B, pipeline: P(4421, B, "success")}`.
    - `ci_lease_release`: default.
12. `mr_view` returns `View(B, true)`.
13. Gate mark-ready (ship): the human answers `{ready: "Mark ready now", next: "Proceed"}`.
14. `mr_ready` returns `{iid: 42, draft: false}`.
15. Run close calls: default.

### S5b

Invocation: Matt: "ship it and watch CI". The ship domain fill above is
inlined. The branch is already pushed at A and MR 42 is open at A; its head
pipeline 4410 ran for A. Nothing is unpushed; `origin/main` has not moved.

1. O1 to O8. `git log --oneline @{upstream}..` prints nothing.
2. O9, O10.
3. `git_rebase {tree: "/work/acme-app", onto: "origin/main"}` returns `{status: "ok", onto: "origin/main", fetched: true}`. After it: `git rev-parse HEAD` prints A; `git log --oneline @{upstream}..` prints nothing; `git merge-base --is-ancestor @{upstream} HEAD` exits 0.
4. O11.
5. (if called) `mr_for_branch` returns `MR42(A, true)` before and after the push.
6. (if called) `mr_pipeline` returns `{pipeline: P(4410, A, "success"), mergeRequestEventType: null}`.
7. `git_push` (with `setUpstream: true` or without) returns `{pushed: true, branch: "feat/widget", sha: A, forceWithLease: false, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4410, mrLookup: "read", tree: "/work/acme-app"}` (git printed `Everything up-to-date`).
8. (if called) `git rev-parse HEAD` prints A.
9. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`; without `ifExists` it returns the 409 tool error from S2.
10. O12, O13.
11. The inherited watch (watch-ci, handed this run's runDb):
    - (if called) `run_snapshot`, `run_enter`: as S4 step 12.
    - (if called) `ci_lease_claim`: `{claimed: true, lease: <own lease>}`.
    - `ci_watch {sha: A}` without `priorPipelineId` returns `{state: "success", sha: A, pipeline: P(4410, A, "success")}`.
    - (if called) `ci_watch {sha: A, priorPipelineId: 4410}` returns `{state: "waiting", sha: A, pipeline: null, budget: null, next: "no pipeline for the sha newer than 4410; call again"}`; the next such call with `attend: true` returns `{state: "no_pipeline", sha: A, pipeline: null, budget: null, pushed: true, remoteSha: A}`, and without `attend` the same `waiting` result again.
    - `ci_lease_release`: default.
12. `mr_view` returns `View(A, true)`.
13. Gate mark-ready (ship): the human answers `{ready: "Keep it draft", next: "Proceed"}`.
14. Run close calls: default.

### S6

Invocation: Matt: "ship it and watch CI". The ship domain fill above is
inlined. As S5 up to the watch, but the doctor attends the MR.

1. S5 steps 1 to 10.
2. The inherited watch (watch-ci, handed this run's runDb):
   - (if called) `run_snapshot`, `run_enter`: as S4 step 12.
   - (if called) `ci_lease_claim` returns `{claimed: false, holder: {owner: "session:other", holder: "doctor", branch: "feat/widget", heartbeatAt: 1792172000000, ttlSeconds: 600}}`.
   - (if called) `ci_watch {sha: B}` with `attend: true` returns `{state: "stood_down", sha: B, pipeline: P(4421, B, "running"), holder: {owner: "session:other", holder: "doctor"}, lease: null, next: "another owner attends this MR"}`; without `attend` it returns `{state: "lease_lost", sha: B, holder: {owner: "session:other", holder: "doctor"}, lease: null}`.
   - (if called) `ci_lease_release` returns `{released: false, reason: "the lease is another owner's"}`.
3. (if called) `mr_view` returns `View(B, true)`.
4. Run close calls: default.

### T10

Invocation: Matt types `/ship` by hand. An earlier ship run of this session is
still open: it passed the ship gate (target `main`, open as draft) and the
pane closed before the push. The domain slot is empty.

1. (if called) `run_list {repo: "app"}` returns `{runs: [{id: "r-ship-0004", status: "running", work_type: "ship", spawned_by: null, started_at: 1792150000000, current_stage: "ship", session: "session:me-7c1e"}]}`.
2. (if called) `run_enter {flags, skillDir, stage: "ship"}` returns `{mode: "candidates", candidates: [{runId: "r-ship-0004", runDb: "/home/dev/.mattstack/runs/app/r-ship-0004/state.db", startedAt: 1792150000000, spawnedBy: null, currentStage: "ship", ownSession: true}]}`.
3. Gate clarify (the Resume offer): the human answers `{resume: "Resume r-ship-0004", next: "Proceed"}`.
4. (if called) `run_enter {..., resume: "r-ship-0004"}` returns `{mode: "resumed", runDb: "/home/dev/.mattstack/runs/app/r-ship-0004/state.db", runId: "r-ship-0004", at: {stage: "ship", attempt: 2, status: "running", file: null}, clearedHold: false}`.
5. (if called) `run_stage {action: start, stage: ship, runDb: ...r-ship-0004...}` returns `{ok: true, attempt: 2}`. (if called) `run_field_set {key: hold, value: "-"}`: default.
6. `run_snapshot {runDb: ...r-ship-0004...}` returns `{run: {id: "r-ship-0004", status: "running", work_type: "ship", current_stage: "ship"}, stages: [{stage: "ship", attempt: 1, status: "redirected"}, {stage: "ship", attempt: 2, status: "running"}], fields: {branch: "feat/widget", shipTarget: "main"}, decisions: [{scope: "ship", selection: {dirty: null, open_as: "draft", next: "proceed"}, decidedBy: "human"}]}`.
7. O5, O7. `branch_stack` returns `{branch: "feat/widget", member: false, stackStore: "read", tree: "/work/acme-app"}`. `run_field_get {key: shipTarget}` returns `{key: "shipTarget", value: "main"}`. `git log --oneline @{upstream}..` prints the S1 `fatal: no upstream` line; `git log --oneline -5` as S1.
8. O11. (if called) `mr_for_branch` returns `NoMR`.
9. `git_push {tree: "/work/acme-app", setUpstream: true}` returns `{pushed: true, branch: "feat/widget", sha: A, forceWithLease: false, upstream: "origin/feat/widget", mr: null, priorPipelineId: null, mrLookup: "read", tree: "/work/acme-app"}`.
10. `mr_create` returns `{iid: 42, url: "<MR>"}`; with `ifExists: "return"` it returns `{iid: 42, url: "<MR>", existing: false}`.
11. O12, O13.
12. Run close calls: default.

### ship evidence fill (EV1, EV2)

Inlined at `{{slot:domain}}`:

```markdown
## Ship rules (acme/app)

- Before the gate: nothing to gather. Fast checks: none.
- AFTER: one case, `widgets-page` ("Widgets page shows the count badge"),
  captured in both themes with `browser_take_screenshot` on
  `http://localhost:5173/widgets`. Mark the count badge on each.
- Evidence heading: `## Verification Evidence`.
- Do not watch CI from ship.
```

`<EV>` is `/home/dev/.mattstack/work/r-ship-0002/evidence/widgets-page`.

### EV1

Invocation: Matt: "ship this". The ship evidence fill above is inlined. The
branch has never been pushed.

1. O1 to O8. `git log` as S1 step 1.
2. O9, O10, O11.
3. `git_push` as S1 step 4.
4. `mr_create` as S1 step 6.
5. O12, O13.
6. `browser_take_screenshot` writes `/home/dev/.fast-browser/screenshots/widgets-light.png` in the light theme and `/home/dev/.fast-browser/screenshots/widgets-dark.png` in the dark theme.
7. The first `evidence_record` (those two paths, case `widgets-page` with its label, slot `after`, theme `light` and `dark`) returns `{written: false, encoding: "evidence@2", value: <the record naming <EV>/widgets-light.png and <EV>/widgets-dark.png>, uncovered: [{case: "widgets-page", slot: "after", theme: "light", path: "<EV>/widgets-light.png", why: "no annotated board or waiver"}, {case: "widgets-page", slot: "after", theme: "dark", path: "<EV>/widgets-dark.png", why: "no annotated board or waiver"}], copied: ["<EV>/widgets-light.png", "<EV>/widgets-dark.png"]}`.
8. Drawing the marks writes `<EV>/widgets-light-annotated.png` and `<EV>/widgets-dark-annotated.png`.
9. `evidence_record` naming `<EV>/widgets-light.png` and `<EV>/widgets-dark.png`, each with its `annotated` board and a `caption` (and the case label), returns `{written: true, encoding: "evidence@2", value: <the record with both boards>, uncovered: [], copied: [the two boards]}`.
10. `evidence_attach {runDb, stage: "ship", heading: "## Verification Evidence", mrUrl: "<MR>"}` returns `{forge: "gitlab", mr: {iid: 42, url: "<MR>"}, uploaded: [{file: "widgets-light-annotated.png", markdown: "![widgets-light-annotated](/uploads/a1/widgets-light-annotated.png)"}, {file: "widgets-dark-annotated.png", markdown: "![widgets-dark-annotated](/uploads/b2/widgets-dark-annotated.png)"}], refused: {}, timedOutTwice: [], linked: [], section: "## Verification Evidence\n\n<the case, both boards and captions>", descriptionWritten: true}`.
11. (if called) `mr_view` returns `View(A, true)` with that section as its description. (if called) `mr_update`: `{ok: true}`.
12. Run close calls: default.

### EV2

Invocation: Matt: "ship this". As EV1, but the dark board is too large to upload.

1. EV1 steps 1 to 9.
2. `evidence_attach {runDb, stage: "ship", heading: "## Verification Evidence", mrUrl: "<MR>"}` returns `{forge: "gitlab", mr: {iid: 42, url: "<MR>"}, uploaded: [{file: "widgets-light-annotated.png", markdown: "![widgets-light-annotated](/uploads/a1/widgets-light-annotated.png)"}], refused: {size: [{file: "widgets-dark-annotated.png", path: "<EV>/widgets-dark-annotated.png", why: "11.8 MB, over the 10 MB upload limit"}]}, timedOutTwice: [], linked: [], section: "<the section>", descriptionWritten: false, notWritten: "a refused file blocks the write"}`.
3. Gate off-script (upload refused): the human answers `{action: "Take the proposed move: link it as attached separately", next: "Proceed", note: null}`.
4. `evidence_attach` with `linkRefused: true` returns `{forge: "gitlab", mr: {iid: 42, url: "<MR>"}, uploaded: [{file: "widgets-light-annotated.png", markdown: "![widgets-light-annotated](/uploads/a1/widgets-light-annotated.png)", reused: true}], refused: {size: [{file: "widgets-dark-annotated.png", path: "<EV>/widgets-dark-annotated.png", why: "11.8 MB, over the 10 MB upload limit"}]}, timedOutTwice: [], linked: ["widgets-dark-annotated.png"], section: "<the section, naming widgets-dark-annotated.png (attached separately)>", descriptionWritten: true}`.
5. (if called) `mr_view` returns `View(A, true)` with that section as its description. (if called) `mr_update`: `{ok: true}`.
6. Run close calls: default.

---

## stage-ship

### stage-ship entry (every scenario)

The work orchestrator enters the ship stage of run
`/home/dev/.mattstack/runs/app/r-work-0003/state.db` (attempt 1; stage fields
as `{{stage.fields}}` renders them: runDb that path, stage `ship`). The domain
slot is empty unless the scenario says otherwise.

- E1. (if called) `run_field_get {key: commits}` returns `{key: "commits", value: "3f9c2a7 add widget"}` (S2, S5: `"3f9c2a7 add widget\n8d2e4f6 fix widget count off by one"`).
- E2. (if called) `run_field_get {key: ticket}` returns `{key: "ticket", value: "https://tracker.example.com/issues/77"}`.
- E3. `git rev-parse --show-toplevel` prints `/work/acme-app`; `git branch --show-current` prints `feat/widget`; `git symbolic-ref --short refs/remotes/origin/HEAD` prints `origin/main`.
- E4. `git status --porcelain` prints nothing.
- E5. `branch_stack {tree: "/work/acme-app"}` returns `{branch: "feat/widget", member: false, stackStore: "read", tree: "/work/acme-app"}`.
- E6. `run_field_get {key: shipTarget}` returns a tool error: `{error: "run field shipTarget is not set"}`.
- E7. Gate ship: the human answers `{open_as: "Push and open as draft", next: "Proceed"}`.
- E8. `run_field_set {key: shipTarget, value: "main"}`: default.
- E9. (if called) `git remote get-url origin` prints `git@gitlab.example.com:acme/app.git`.
- E10. `run_field_set {key: mr}`: default. (if called) `run_field_set {key: pushed}`: default.
- E11. `run_field_get {key: evidence}` returns a tool error: `{error: "run field evidence is not set"}`.
- E12. `mr_view` returns `View(<the pushed sha>, true)`. (if called) `mr_update {mrUrl, title, description}`: `{ok: true}`.

### S1

1. E1 to E6. `git log --oneline @{upstream}..` prints `fatal: no upstream configured for branch 'feat/widget'` and exits 128; `git log --oneline -5` prints `3f9c2a7 add widget` then `9b8a7c6 Merge branch 'release' into main`.
2. E7, E8.
3. `git_push {tree: "/work/acme-app", setUpstream: true}` returns `{pushed: true, branch: "feat/widget", sha: A, forceWithLease: false, upstream: "origin/feat/widget", mr: null, priorPipelineId: null, mrLookup: "read", tree: "/work/acme-app"}`.
4. (if called) `git rev-parse HEAD` prints A. E9.
5. (if called) `mr_for_branch` returns `NoMR`.
6. `mr_create {repoName: "/work/acme-app", sourceBranch: "feat/widget", targetBranch: "main", title, description, draft: true}` returns `{iid: 42, url: "<MR>"}`; with `ifExists: "return"` it returns `{iid: 42, url: "<MR>", existing: false}`.
7. E10, E11, E12.

### S2

An MR is already open at A (head pipeline 4415); one new commit B is local.

1. E1 to E6. `git log --oneline @{upstream}..` prints `8d2e4f6 fix widget count off by one`.
2. E7, E8.
3. `git_push` (with `setUpstream: true` or without) returns `{pushed: true, branch: "feat/widget", sha: B, forceWithLease: false, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4415, mrLookup: "read", tree: "/work/acme-app"}`.
4. (if called) `git rev-parse HEAD` prints B. (if called) `mr_pipeline` returns `{pipeline: P(4421, B, "running"), mergeRequestEventType: null}`. E9.
5. (if called) `mr_for_branch` returns `MR42(B, true)`.
6. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`; without `ifExists` it returns a tool error: `{error: "GitLab refused: 409 Another open merge request already exists for this source branch: !42"}`.
7. E10, E11, E12.

### S3

1. E1 to E6. `git log` as S1 step 1.
2. E7, E8.
3. `git_push {tree: "/work/acme-app", setUpstream: true}` returns a tool error: `{error: "git push failed (exit 128): ssh: connect to host gitlab.example.com port 22: Operation timed out"}`. Any retry returns the same error.
4. Gate off-script (git_push refused): the human answers `{action: "Take the proposed move: I pushed feat/widget from my own terminal", next: "Proceed", note: "pushed it over the VPN"}`.
5. (if called) `git rev-parse HEAD` prints A. (if called) `git ls-remote origin refs/heads/feat/widget` prints `3f9c2a7e1b4d8c6f0a5e9b2d7c1f4a8e6b3d9c05	refs/heads/feat/widget`. (if called) `mr_pipeline` returns a tool error: `{error: "no MR is open on feat/widget"}`.
6. E9. (if called) `mr_for_branch` returns `NoMR`.
7. `mr_create` returns `{iid: 42, url: "<MR>"}`; with `ifExists: "return"` it returns `{iid: 42, url: "<MR>", existing: false}`.
8. E10, E11, E12.

### S4

The ship domain fill from the ship section is inlined. The branch was pushed
earlier as C (MR 42's head, pipeline 4410); `origin/main` has moved since.

1. E1 to E6. `git log --oneline @{upstream}..` prints nothing.
2. E7, E8.
3. `git_rebase {tree: "/work/acme-app", onto: "origin/main"}` returns `{status: "ok", onto: "origin/main", fetched: true}`. After it: `git rev-parse HEAD` prints A; `git log --oneline @{upstream}..` prints `3f9c2a7 add widget`; `git log --oneline HEAD..@{upstream}` prints `1a2b3c4 add widget`; `git merge-base --is-ancestor @{upstream} HEAD` exits 1.
4. (if called) `git_push` without `forceWithLease` returns a tool error: `{error: "git push failed (exit 1): ! [rejected] HEAD -> feat/widget (non-fast-forward)"}`.
5. (if called) Gate off-script (git_push refused): the human answers `{action: "Hand back", next: "Proceed"}`.
6. (if called) `git_push {tree: "/work/acme-app", forceWithLease: true}` returns `{pushed: true, branch: "feat/widget", sha: A, forceWithLease: true, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4410, mrLookup: "read", tree: "/work/acme-app"}`.
7. (if called) `mr_pipeline` returns `{pipeline: P(4416, A, "running"), mergeRequestEventType: null}`. E9.
8. (if called) `mr_for_branch` returns `MR42(A, true)`.
9. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`; without `ifExists` it returns the 409 tool error from S2.
10. E10, E11, E12.

### S5

The ship domain fill from the ship section is inlined. An MR is open at A
(head pipeline 4415); one new commit B is local; `origin/main` has not moved.

1. E1 to E6. `git log --oneline @{upstream}..` prints `8d2e4f6 fix widget count off by one`.
2. E7, E8.
3. `git_rebase {tree: "/work/acme-app", onto: "origin/main"}` returns `{status: "ok", onto: "origin/main", fetched: true}`. After it: `git rev-parse HEAD` prints B; `git log --oneline @{upstream}..` prints `8d2e4f6 fix widget count off by one`; `git merge-base --is-ancestor @{upstream} HEAD` exits 0.
4. `git_push` (with `setUpstream: true` or without) returns `{pushed: true, branch: "feat/widget", sha: B, forceWithLease: false, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4415, mrLookup: "read", tree: "/work/acme-app"}`.
5. (if called) `git rev-parse HEAD` prints B. (if called) `mr_pipeline` returns `{pipeline: P(4421, B, "running"), mergeRequestEventType: null}`. E9.
6. (if called) `mr_for_branch` returns `MR42(B, true)`.
7. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`; without `ifExists` it returns the 409 tool error from S2.
8. E10, E11, E12.

### S5b

The ship domain fill from the ship section is inlined. The branch is already
pushed at A and MR 42 is open at A; its head pipeline 4410 ran for A. Nothing
is unpushed; `origin/main` has not moved.

1. E1 to E6. `git log --oneline @{upstream}..` prints nothing.
2. E7, E8.
3. `git_rebase {tree: "/work/acme-app", onto: "origin/main"}` returns `{status: "ok", onto: "origin/main", fetched: true}`. After it: `git rev-parse HEAD` prints A; `git log --oneline @{upstream}..` prints nothing; `git merge-base --is-ancestor @{upstream} HEAD` exits 0.
4. `git_push` (with `setUpstream: true` or without) returns `{pushed: true, branch: "feat/widget", sha: A, forceWithLease: false, upstream: "origin/feat/widget", mr: {iid: 42, url: "<MR>"}, priorPipelineId: 4410, mrLookup: "read", tree: "/work/acme-app"}` (git printed `Everything up-to-date`).
5. (if called) `git rev-parse HEAD` prints A. (if called) `mr_pipeline` returns `{pipeline: P(4410, A, "success"), mergeRequestEventType: null}`. E9.
6. (if called) `mr_for_branch` returns `MR42(A, true)`.
7. (if called) `mr_create` with `ifExists: "return"` returns `{iid: 42, url: "<MR>", existing: true, targetBranch: "main", draft: true, title: "Add widget", applied: false}`; without `ifExists` it returns the 409 tool error from S2.
8. E10, E11, E12.

### EV1

The evidence stage recorded one case; the domain slot is empty.
`<EV>` is `/home/dev/.mattstack/work/r-work-0003/evidence/badge-count`.

1. Entry E1 to E6. `git log` as S1 step 1.
2. Entry E7, E8.
3. `git_push` as S1 step 3. (if called) `git rev-parse HEAD` prints A. Entry E9.
4. `mr_create` as S1 step 6.
5. Entry E10.
6. `run_field_get {key: evidence}` returns `{key: "evidence", value: <the record: case badge-count, "Badge shows the item count", its before a {light, dark} pair at <EV>/before-light.png and <EV>/before-dark.png, annotated <EV>/before-light-annotated.png and <EV>/before-dark-annotated.png, each with a caption>}`.
7. (if read) the repo has no MR template.
8. (if called) `evidence_record` naming `<EV>/before-light.png` and `<EV>/before-dark.png` with their boards and captions returns `{written: true, encoding: "evidence@2", value: <the same record>, uncovered: [], copied: []}`.
9. `evidence_attach {runDb, stage: "ship", heading: "## Evidence", mrUrl: "<MR>"}` returns `{forge: "gitlab", mr: {iid: 42, url: "<MR>"}, uploaded: [{file: "before-light-annotated.png", markdown: "![before-light-annotated](/uploads/c3/before-light-annotated.png)"}, {file: "before-dark-annotated.png", markdown: "![before-dark-annotated](/uploads/d4/before-dark-annotated.png)"}], refused: {}, timedOutTwice: [], linked: [], section: "## Evidence\n\n<the case, both boards and captions>", descriptionWritten: true}`.
10. `mr_view` returns `View(A, true)` with that section as its description. (if called) `mr_update {mrUrl, title, description}`: `{ok: true}`.

### EV2

As EV1, but the dark board is too large to upload.

1. EV1 steps 1 to 8.
2. `evidence_attach {runDb, stage: "ship", heading: "## Evidence", mrUrl: "<MR>"}` returns `{forge: "gitlab", mr: {iid: 42, url: "<MR>"}, uploaded: [{file: "before-light-annotated.png", markdown: "![before-light-annotated](/uploads/c3/before-light-annotated.png)"}], refused: {size: [{file: "before-dark-annotated.png", path: "<EV>/before-dark-annotated.png", why: "11.8 MB, over the 10 MB upload limit"}]}, timedOutTwice: [], linked: [], section: "<the section>", descriptionWritten: false, notWritten: "a refused file blocks the write"}`.
3. Gate off-script (upload refused): the human answers `{action: "Take the proposed move: link it as attached separately", next: "Proceed", note: null}`.
4. `evidence_attach` with `linkRefused: true` returns `{forge: "gitlab", mr: {iid: 42, url: "<MR>"}, uploaded: [{file: "before-light-annotated.png", markdown: "![before-light-annotated](/uploads/c3/before-light-annotated.png)", reused: true}], refused: {size: [{file: "before-dark-annotated.png", path: "<EV>/before-dark-annotated.png", why: "11.8 MB, over the 10 MB upload limit"}]}, timedOutTwice: [], linked: ["before-dark-annotated.png"], section: "<the section, naming before-dark-annotated.png (attached separately)>", descriptionWritten: true}`.
5. `mr_view` returns `View(A, true)` with that section as its description. (if called) `mr_update {mrUrl, title, description}`: `{ok: true}`.
