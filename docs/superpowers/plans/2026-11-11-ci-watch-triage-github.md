# CI watch and triage on GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ci_watch`, `ci_triage`, `pipeline_jobs` and `rt ci watch` work on a GitHub PR through the same code paths as GitLab.

**Architecture:** A new `lib/ci/github-forge.ts` turns glance's synthetic PR pipeline into a "GitHub head" (required-check blocking, stable id, budget anchor) using a few per-commit daemon reads, then supplies GitHub implementations of the existing `WatchDeps` reads and the `TriageForge` interface. `watchPipeline` gets two GitLab-neutral changes; `runTriage` none.

**Tech Stack:** Bun, TypeScript, `bun:test`, the rt daemon command client (`rtCommand`), glance types.

**Spec:** `docs/superpowers/specs/2026-11-11-ci-watch-triage-github-design.md`

## Global Constraints

- GitLab behaviour does not change: every existing GitLab test passes unmodified. Rewritten tests are only those that assert today's GitHub refusal: `unsupported_forge`, "ci_watch is GitLab only", the PR-URL resolve error (`ci-tools.test.ts` "a GitHub PR passed as mrUrl without attend is still a resolve error") and the `pipeline_jobs` "GitLab only." description assertion.
- Octokit and gitbeaker only (no new forge client); all forge reads go through daemon verbs: `mr:get`, `mr:pipeline-failed-jobs`, `mr:fetch-job-trace`, `pipeline:list`, `forge:get`.
- No live forge calls in tests: stub `command` and `resolve`. Never run rt, the daemon or a built binary against the real HOME.
- Write only: `lib/ci/**`, `lib/mcp/ci-tools.ts`, `lib/mcp/mr-read-tools.ts` (pipeline_jobs and `readPipelineSubject` only), `commands/ci.ts`, their `__tests__`, `plugins/mattstack/attachments/mcp-tools/reference.md`, `plugins/mattstack/.claude-plugin/plugin.json`, recompiled plugin output, `docs/superpowers/**`.
- GitHub `ci_watch` `intervalSeconds`: default 60, range 30 to 120. GitLab: default 30, range 10 to 120.
- Per-commit reads (required list, anchor) cost one read each per commit: persisted in the watch state with `attend`, cached in-process by `<prUrl>#<full head sha, lowercased>` without (the key always uses `mr.sha` from `mr:get`, never the caller's short sha). Required-list attempts: at most 3 per commit (one try, two retries). Anchor listing attempts: at most 3 per commit. Success confirmation: at most once per 5 minutes per commit.
- No em or en dashes in code, comments, copy or docs. Comments only for constraints the code cannot show.
- Run only touched test files: `bun test <file>` from the worktree root.

## Review Focus

1. A required check that has not reported yet (a `needs:` aggregator job): the head must read `pending`, never `success`, and an optional red check must not block. Pinned in Task 1.
2. A fast external commit status that reports before the Actions run exists: the watch must not freeze the first-seen fallback; the anchor upgrades once a check with a `runId` appears. Pinned in Task 2.
3. A commit status context whose name ends in `:<digits>` (for example `ci/build:12`): it must still be a `jobId: null` row, never parsed as a job id. Pinned in Task 3.
4. A required-list read that keeps failing (403, GHES without rulesets): at most 2 retries per commit, glance's `isRequired` meanwhile; a 404 is an answer, not a failure. Pinned in Task 2.
5. A base branch where a job was cancelled, not failed: it must not mark the PR's same-named failure INHERITED. Pinned in Task 5.

---

### Task 1: GitHub head, pure core

**Files:**
- Create: `lib/ci/github-forge.ts`
- Test: `lib/ci/__tests__/github-forge.test.ts`

**Interfaces:**
- Consumes: glance `Pipeline` / `PipelineJob` (`@mattstack/glance`; `PipelineJob.runId?: string | null`).
- Produces:
  - `export interface GithubJob { id: string; jobId: number | null; name: string; status: string; blocking: boolean; runId: number | null; webUrl: string | null }`
  - `export interface GithubCommitFacts { required: string[] | null; requiredTries: number; anchor: { runId: number | null; createdAt: number } | null; anchorTries: number; confirm: { at: number; open: boolean } | null }`
  - `export function emptyFacts(): GithubCommitFacts` (all null, tries 0)
  - `export interface GithubHead { id: string; number: number; status: string; sha: string | null; ref: string | null; webUrl: string | null; createdAt: string | null; jobs: GithubJob[]; allBlock: boolean }`
  - `export function buildHead(p: Pipeline, facts: GithubCommitFacts): GithubHead`
  - `export function restJobStatus(status: string | null, conclusion: string | null): string`
  - `export function requiredNames(rules: unknown, branch: unknown): string[]` (rules body of `:repo/rules/branches/<b>`, body of `:repo/branches/<b>`)
  - `export const GITHUB_INFRA_PATTERNS: readonly string[]` (the four spec patterns, regex-escaped where needed)

- [ ] **Step 1: Write the failing tests** in `lib/ci/__tests__/github-forge.test.ts`:
  - `restJobStatus`: `("completed","success")` and `("completed","neutral")` → `"success"`; `failure`, `timed_out`, `stale`, `startup_failure` → `"failed"`; `cancelled` → `"canceled"`; `skipped` → `"skipped"`; `action_required` → `"manual"`; `("in_progress", null)` → `"running"`; `("queued", null)` → `"pending"`.
  - `requiredNames`: rules body `[{type:"required_status_checks", parameters:{required_status_checks:[{context:"checks"}]}}, {type:"pull_request"}]` plus branch body `{protection:{required_status_checks:{contexts:["lint"]}}}` → `["checks","lint"]` (deduped, sorted); `([], {protected:false})` → `[]`; non-object bodies → `[]`.
  - `buildHead` with `required: ["checks"]`, jobs `lint` (failed, glance `allowFailure: true`) and `build` (success), no `checks` job: `status === "pending"`, `lint.blocking === false`, `allBlock === false`.
  - Same with a `checks` job `success` and `lint` failed: `status === "success"`, `lint.blocking === false`.
  - `required: ["checks"]`, `checks` job `manual` → `"pending"`; `checks` `skipped` → `"success"`; order failed > canceled > running > pending.
  - `required: []`: every job blocks, `allBlock === true`, status aggregates every job.
  - `required: null`, glance jobs with `allowFailure` from `isRequired`: blocking = `!allowFailure`; when no job has `allowFailure: false`, every job blocks and `allBlock === true`.
  - Ids: `github:check:77` → `jobId 77`; `github:status:ci/build:12` → `jobId null` (prefix wins, Review Focus 3); `runId "5"` → `5`.
  - Anchor: `anchor {runId: 900, createdAt: Date.parse("2026-11-11T10:00:00Z")}` → `id "github:run:900"`, `number 900`, `createdAt "2026-11-11T10:00:00.000Z"`; `anchor {runId: null, ...}` → `id` is glance's, `number 0`, `createdAt` from the anchor; `anchor null` → glance's id, `number 0`, `createdAt null`.
  - `facts.confirm {open: true}` with `allBlock` and an aggregate of `success` → `status "running"`; `confirm` ignored when `allBlock` is false.

- [ ] **Step 2: Run** `bun test lib/ci/__tests__/github-forge.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** the exports in `lib/ci/github-forge.ts`. Aggregate over the blocking set: failed, else canceled, else running, else pending (pending, manual, or any missing required name), else success (skipped counts as success). `number` is `anchor.runId ?? 0`.

- [ ] **Step 4: Run** the test file. Expected: PASS. Also `bun run typecheck`.

- [ ] **Step 5: Commit** `git add lib/ci/github-forge.ts lib/ci/__tests__/github-forge.test.ts && git commit -m "ci: GitHub head core (required checks, anchor, status)"`

### Task 2: Per-commit reads and the facts store

**Files:**
- Modify: `lib/ci/github-forge.ts`, `lib/ci/watch-state.ts`
- Test: `lib/ci/__tests__/github-forge.test.ts`, `lib/ci/__tests__/watch-state.test.ts`

**Interfaces:**
- Consumes: Task 1; `rtCommand` type; `Commands["pipeline:list"]`, `Commands["forge:get"]`, `Commands["mr:get"]` from `packages/rt-client/src/index.ts`.
- Produces:
  - `PersistedWatch.github?: GithubCommitFacts` (optional; `fresh()` leaves it unset; `parse` keeps it when it is an object)
  - `export interface FactsStore { get(): GithubCommitFacts; set(f: GithubCommitFacts): void }`
  - `export function memoryFacts(key: string): FactsStore` (module-level `Map`, key `<prUrl>#<full sha lowercased>`) and `export function __resetMemoryFacts(): void` (tests call it in `beforeEach`)
  - `export interface GithubTarget { identity: string; iid: number }`
  - `export class GithubHeadReader { constructor(command: typeof rtCommand, target: GithubTarget, store: FactsStore, now: () => number); read(mr: { sha: string | null; targetBranch: string | null; pipeline: Pipeline | null }, watchedSha: string | null): Promise<GithubHead | null> }`
  - `export const CONFIRM_EVERY_MS = 300_000`, `REQUIRED_TRIES = 3`, `ANCHOR_TRIES = 3` (attempts per commit)

- [ ] **Step 1: Write the failing tests** with a stub `command` that records `(name, payload)`:
  - First `read` with checks on the watched sha: one `forge:get :repo/rules/branches/feat%2Fx`, one `forge:get :repo/branches/feat%2Fx` (target branch `feat/x`, encoded once), one `pipeline:list {ref, sha, limit: 100}`; second `read` with the same store: zero `forge:get` and zero `pipeline:list` calls.
  - A 404 (`{ok: true, data: {status: 404, ...}}` or `ok:false` with `GitHub returned 404`) on rules counts as an answer: list kept, no retry.
  - A 403 on either read: `required` stays null, glance blocking applies, next read retries; after 3 failed attempts no further required reads for that commit (Review Focus 4).
  - Anchor: the first read with checks on the watched sha always sets the fallback `{runId: null, createdAt: now()}` (first seen), so the budget is never left without an anchor. Listing rows `[{id: 902, createdAt: "...:05Z"}, {id: 900, createdAt: "...:00Z"}]` → anchor 900. With no job carrying a `runId`, no listing is made; once a later read has a job with `runId`, one listing runs and replaces the fallback (Review Focus 2); an empty or failed listing keeps the fallback and retries on later reads, at most 3 attempts, after which the fallback stands for the commit.
  - `watchedSha` not matching `mr.sha`, or a null pipeline: no per-commit reads, returns `buildHead` result or null.
  - Confirmation runs whenever `allBlock` is true (an empty required list, or a null list with no glance check required): aggregate success, listing has a run with status `running` → head `running`; the same with a `pending` run → `running`; a second read within 5 minutes makes no listing and stays `running`; after 5 minutes it reads again. A run counts as not completed unless its status is `success`, `failed`, `canceled`, `skipped` or `manual`. A failed confirmation listing leaves the head `success`. With a non-empty required list no confirmation listing is made.
  - `watch-state.test.ts`: a written state with `github` facts reads back with them; a new sha reads back without them.

- [ ] **Step 2: Run** both test files. Expected: FAIL.

- [ ] **Step 3: Implement** `memoryFacts`, `GithubHeadReader.read` and the `PersistedWatch.github` field. Required list: read both paths; any non-404 failure (including a guard refusal) leaves `required` null and bumps `requiredTries`. Store via `store.set` after each change.

- [ ] **Step 4: Run** both test files and `bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `git add lib/ci/github-forge.ts lib/ci/watch-state.ts lib/ci/__tests__/github-forge.test.ts lib/ci/__tests__/watch-state.test.ts && git commit -m "ci: GitHub per-commit reads and facts store"`

### Task 3: Watch loop, commit-status rows

**Files:**
- Modify: `lib/ci/watch.ts`
- Test: `lib/ci/__tests__/watch.test.ts`

**Interfaces:**
- Produces: `WatchResult["failedJobs"][number].jobId: number | null`; `WatchState` without `"unsupported_forge"`.

- [ ] **Step 1: Write the failing tests:** a terminal failed pipeline whose jobs are `github:check:7` (failed, blocking) and `github:status:ci/build:12` (failed, blocking) with `failedJobs` dep returning `[]`: `failedJobs` has two rows, the status row `jobId: null` with no `traceTail`, `blockingFailures === 2`, `traceTail` requested only for job 7.

- [ ] **Step 2: Run** `bun test lib/ci/__tests__/watch.test.ts`. Expected: the new test FAILs.

- [ ] **Step 3: Implement** in `failures()`: a job id starting `github:status:` is a row with `jobId: null` and no trace; any other id with no number is still skipped. Remove `"unsupported_forge"` from `WatchState`.

- [ ] **Step 4: Run** the file (all existing tests unchanged) and `bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "ci: list commit-status failures in the watch result"` (named files only).

### Task 4: ci_watch on GitHub

**Files:**
- Modify: `lib/mcp/ci-tools.ts`, `commands/ci.ts` (header comment and usage text only if they say MR only)
- Test: `lib/mcp/__tests__/ci-tools.test.ts`, `commands/__tests__/ci.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3 (`GithubHeadReader`, `memoryFacts`, `FactsStore`).
- Produces: `GITHUB_INTERVAL_DEFAULT = 60`, `GITHUB_INTERVAL_MIN = 30` in `ci-tools.ts`.

- [ ] **Step 1: Write the failing tests** (replace the two `unsupported_forge` ci_watch tests, the "ci_watch is GitLab only" test, and "a GitHub PR passed as mrUrl without attend is still a resolve error", which becomes: a PR URL for an unregistered repo is the resolver's registration error, not `MR_URL_SHAPE`). Call `__resetMemoryFacts()` in `beforeEach`. Stub `mr:get` returning `webUrl: "https://github.com/acme/proj/pull/42"`, `targetBranch: "main"`, glance pipeline with `github:check:` jobs; stub `forge:get` and `pipeline:list`:
  - a PR going `running` then `success` returns `state: "success"`, `pipeline.id: "github:run:900"`;
  - an optional failed check plus a successful required check returns `success` with `blockingFailures: 0`;
  - a required failed check returns `failed` with its `traceTail` from `mr:fetch-job-trace`;
  - the budget: anchor `createdAt` 80 minutes before `now`, setting 75, still running, `attend: true` → `state: "timeout"`;
  - the first poll: the required `checks` job has not reported and an optional `lint` has failed (glance's raw status `failed`) → the call returns `running` or `waiting`, never `failed` (the memoized first read goes through the head too);
  - `attend: true` twice for the same sha with `__resetMemoryFacts()` between the calls: the second call makes no `forge:get` or `pipeline:list` call, and the state file at `watchStatePath` holds a `github` object with the required list and anchor;
  - without `attend`, two calls for the same sha: the second makes no per-commit read (memory cache);
  - `intervalSeconds` omitted on GitHub: polls 60 s apart (assert the `sleep` stub's ms); `intervalSeconds: 20` on GitHub → error naming 30 to 120; `intervalSeconds: 20` on GitLab still accepted;
  - a GitHub PR URL as `mrUrl` resolves through `resolve(input, { github: true })` (assert the second argument).
  - `commands/__tests__/ci.test.ts`: `runCiWatch` with a `https://github.com/acme/proj/pull/42` URL and fakes reaching `success` exits 0.

- [ ] **Step 2: Run** `bun test lib/mcp/__tests__/ci-tools.test.ts commands/__tests__/ci.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement** in the `ci_watch` handler: drop both `unsupported_forge` returns and the GitLab-only error; resolve with `{ github: true }`; the first `mr:get` is kept raw and used only for forge detection (GitHub when `parseMrUrl(webUrl) === null`), `mrUrl` and the GitHub interval rule; then the watch state is loaded (with `attend`), the facts store chosen, and the memoized first read is mapped through `GithubHeadReader` before `watchPipeline` sees it; GitHub `WatchDeps`: `readMr` maps `mr:get` through `GithubHeadReader` (store: the watch state's `github` facts with `attend`, writing them back on `observe`; `memoryFacts(<prUrl>#<sha>)` without), `failedJobs` returns `[]`, `traceTail` and `commitParents` unchanged. `toWatchPipeline` takes a `GithubHead` on GitHub (`allowFailure: !blocking`, `stage: "checks"`, `mergeRequestEventType: null`).

- [ ] **Step 4: Run** both files and `bun run typecheck`. Expected: PASS, all GitLab tests unchanged.

- [ ] **Step 5: Commit** `git commit -m "ci_watch: follow GitHub PRs"` (named files only).

### Task 5: ci_triage on GitHub

**Files:**
- Modify: `lib/ci/github-forge.ts`, `lib/mcp/ci-tools.ts`, `lib/mcp/mr-read-tools.ts` (`readPipelineSubject`, `unsupportedGithub` removal)
- Test: `lib/ci/__tests__/github-forge.test.ts`, `lib/mcp/__tests__/ci-tools.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2; `TriageForge`, `ForgeJob`, `BridgeRow`, `runTriage` from `lib/ci/triage.ts`.
- Produces:
  - `export function githubTriageForge(command: typeof rtCommand, target: GithubTarget, head: GithubHead): TriageForge`
  - `PipelineSubject` gains `{ kind: "github"; mr: Commands["mr:get"]["data"]["mr"] }` (replacing `{ kind: "github" }`).

- [ ] **Step 1: Write the failing tests:**
  - `pipelinesForRef("main", 4)`: listing rows (newest first) for shas A (2 runs), B (1 run, `source: "schedule"`), C (1 run) → returns `[groupA, groupC]` with `id` the newest run of each group; `failedJobs(groupA.id)` reads `mr:pipeline-failed-jobs` only for A's runs whose status is `failed`, and drops rows whose status is `canceled` (Review Focus 5).
  - `failedJobs(head.number)`: failed Actions checks become `ForgeJob` rows (`pipelineId` = their run id, `allowFailure: !blocking`); a failed `github:status:` check and a failed check with no `runId` become `crossProject` rows with `downstream: null`.
  - `pipelineInfo(head.number)` returns the head without a request; `pipelineInfo(555)` reads `forge:get :repo/actions/runs/555` and maps `status`/`conclusion`, `html_url`, `head_sha`, `head_branch`; a 404 → null.
  - `defaultBranch()` reads `forge:get :repo` `default_branch`; `infraPatterns()` returns `GITHUB_INFRA_PATTERNS`.
  - `failedJobs(555)` for a run that is neither the head nor a base group (lookup order: `head.number`, then the base group map, else a subject run): reads `mr:pipeline-failed-jobs {pipelineId: 555}`, keeps status `failed` rows; job `github:check:7`, which is an optional check on the head, is `allowFailure: true`; job `github:check:8`, not on the head, is `allowFailure: false`.
  - Tool level (replace the three `unsupported_forge` ci_triage tests; `__resetMemoryFacts()` in `beforeEach`): a GitHub PR with one failed required check whose log matches `Tests:.*failed` and that also failed on a base commit → `state: "triaged"`, `blocking[0].verdict: "REAL"`, `ownership: "INHERITED"`; a team setting `ci.triage.infraPatterns: ["flaky-runner"]` read through `readSetting` turns a matching log INFRA; an optional failed check lands in `nonBlocking`; `pipelineId` equal to the head's anchor id triages the head.

- [ ] **Step 2: Run** `bun test lib/ci/__tests__/github-forge.test.ts lib/mcp/__tests__/ci-tools.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement** `githubTriageForge` per the spec's ci_triage section (`pipelinesForRef` asks `pipeline:list {ref, limit: 100}`, groups by sha, returns at most `limit` groups); `readPipelineSubject` returns the GitHub `mr`; `ci_triage` resolves with `{ github: true }`, builds the head with `GithubHeadReader.read(mr, mr.sha)` and `memoryFacts(<mr.webUrl>#<mr.sha>)`, and runs `runTriage` with `pipelineId` = `head.number` when the input's `pipelineId` is absent. A job on a subject run takes the head's blocking flag by matching job id (`github:check:<n>`).

- [ ] **Step 4: Run** both files and `bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "ci_triage: classify GitHub failures"` (named files only).

### Task 6: pipeline_jobs on GitHub

**Files:**
- Modify: `lib/mcp/mr-read-tools.ts` (`pipeline_jobs` handler, the file's header comment, and deleting `unsupportedGithub` and `isGithubPrUrl` once nothing calls them)
- Test: `lib/mcp/__tests__/mr-read-tools.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5 (`readPipelineSubject` GitHub kind, `GithubHeadReader`, `restJobStatus`).

- [ ] **Step 1: Write the failing tests** (replace the three pipeline_jobs `unsupported_forge` tests):
  - no `pipelineId`: rows from the head, `{jobId, name, stage: "checks", status, allowFailure, blocking, pipelineId, attempt: 1, webUrl}`, a commit status with `jobId: null`, `bridges: []`;
  - `pipelineId: 555`: pages `forge:get :repo/actions/runs/555/jobs` with `query {filter: "latest"}`, `perPage: 30`, following `nextPage`; `attempt` from `run_attempt`; a `forge:get` error naming the 256 KiB cap (or `truncated: true`) halves `perPage` and retries, down to 5 and then errors;
  - run-id rows take the head's blocking flag by job id: job 7 (an optional head check) `blocking: false`, job 8 (not on the head) `blocking: true`;
  - the result's `pipeline` is `{id, status, sha, ref, webUrl}`: the head's (`id` `github:run:<anchor>`) with no `pipelineId`, and for a run id the `forge:get :repo/actions/runs/555` answer mapped through `restJobStatus` with `id` `github:run:555`; a 404 on that read is the error `pipeline 555 not found`, as on GitLab;
  - `scope: "failed"` and `name` filter both forms.

- [ ] **Step 2: Run** `bun test lib/mcp/__tests__/mr-read-tools.test.ts`. Expected: new tests FAIL.

- [ ] **Step 3: Implement** the GitHub branch of `pipeline_jobs`: resolve with `{ github: true }`; the head comes from `GithubHeadReader.read(mr, mr.sha)` with `memoryFacts(<mr.webUrl>#<mr.sha>)` (the required list decides blocking, and the cache is shared with ci_watch and ci_triage, so a PR already watched costs no extra read); `pipelineId` equal to `head.number` means the head. Then delete `unsupportedGithub` and `isGithubPrUrl` if nothing calls them.

- [ ] **Step 4: Run** the file and `bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "pipeline_jobs: list GitHub checks and run jobs"` (named files only).

### Task 7: Tool descriptions, reference, plugin version

**Files:**
- Modify: `lib/mcp/ci-tools.ts` (descriptions), `lib/mcp/mr-read-tools.ts` (`pipeline_jobs` description), `plugins/mattstack/attachments/mcp-tools/reference.md`, `plugins/mattstack/.claude-plugin/plugin.json`, any compiled plugin output the compile rewrites.
- Test: `lib/mcp/__tests__/mr-read-tools.test.ts` (the "descriptions say GitLab only exactly where the tool still is" test: `pipeline_jobs` moves into the list that must not contain "GitLab only" and must contain the PR URL note), `lib/mcp/__tests__/ci-tools.test.ts` (add: `ci_watch` and `ci_triage` descriptions do not contain "GitLab only" and contain `PR_URL_NOTE`).

- [ ] **Step 1: Rewrite descriptions.** `ci_watch`: drop "GitLab only" and the `unsupported_forge (a GitHub PR)` clause; add one sentence on GitHub: the pipeline is every check on the PR head, required checks (from the target branch's rules and protection) decide blocking and status, `intervalSeconds` defaults to 60 and runs 30 to 120 there, the budget runs from the head's first Actions run, a commit status failure has `jobId: null`, `priorPipelineId` is ignored. `ci_triage`: drop "GitLab only"; on GitHub `pipelineId` is a workflow run id (default the PR head's checks), base pipelines are base-branch commits, and a check rt cannot read a log for is listed under `crossProject`. `pipeline_jobs`: drop "GitLab only"; on GitHub, default the head's checks, `pipelineId` a workflow run. All three append `PR_URL_NOTE`. Follow `rt:ui-copy` rules; no dashes.

- [ ] **Step 2: Regenerate the reference** under an isolated HOME: `T=$(mktemp -d) && env -i HOME="$T" PATH="$PATH" bun cli.ts mcp tools --json | env -i HOME="$T" PATH="$PATH" bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`. Expected: only the three tools' entries change (`git diff --stat`).

- [ ] **Step 3: Bump and recompile.** `git fetch origin main`; set `plugin.json` `version` one patch past `origin/main`'s. Run `env -i HOME="$T" PATH="$PATH" bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$T/mattstack" --strict`; if it reports compile drift, run the same with `skills compile` (no `--dry-run`) and re-run check. Expected: check clean.

- [ ] **Step 4: Verify:** `bun test` on every touched test file, `bun run typecheck`, `bun run purity`, `bun run docs:check`, and the reference diff (Step 2's command into a temp file, `cmp` against the committed one). Expected: all pass, `cmp` silent.

- [ ] **Step 5: Commit** `git commit -m "mcp-tools: describe GitHub CI watch, triage and pipeline_jobs; bump plugin"` (named files only).

## After the plan

The PR body (written at push time, not a task) carries: the full per-hour GitHub request numbers from the spec's cost paragraph, the engine-floor line (`engine-floor: unchanged` with its reason: no skill text calls a new tool or argument), and the follow-ups outside the write fence (`lib/command-tree-def.ts` `rt ci watch` hints, `.claude/rules/mcp-and-gates.md`, the stage skills' dead `unsupported_forge` branch).
