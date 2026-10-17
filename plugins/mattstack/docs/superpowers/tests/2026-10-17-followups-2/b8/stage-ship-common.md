# Test scenario: the ship stage of a run

You are the agent running the `ship` stage of a pipeline run. The compiled
stage-ship skill is in your system prompt; follow it exactly. Tools are
unavailable in this test: you cannot execute anything. List every tool call
or shell command you would make, in order, with its arguments (JSON), and
where you stop and why. Where the scenario gives a result or a gate answer,
use it.

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
