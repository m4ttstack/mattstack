# CI tools in rt's MCP server: design

## Why

The watch-ci and ship skills, and the board doctor packs, spend most of their
words on mechanics: picking one of four ways to triage, running a shell triage
engine that needs glab and jq, carrying budget numbers and a prior pipeline id
between `ci_watch` calls, counting waiting results and lost leases, and
heartbeating a lease every five minutes during a fix. Models miscount those
loops, lose them on compaction and resume, and miss the timing rule. The
shell engine can also triage the wrong pipeline when it is called with
`--ref`, which picks the newest pipeline on the branch and not the one for the
watched commit.

This lane moves those mechanics into rt's MCP server. The tools return
results; the skills keep every gate and every judgment. Skills do not change
in this wave (wave 3 shrinks them), so every change here must leave today's
installed skills working.

## Goals

1. `ci_triage`: a native TypeScript port of `ci-triage.sh` and its GitLab
   forge adapter. It returns a structured verdict per failed job (REAL, INFRA
   or UNCLEAR, and yours, INHERITED or UNKNOWN), with the team's patterns
   supplied as config.
2. `pipeline_jobs`: one pipeline's job listing, child pipelines included.
3. `ci_watch` v2: claims and re-claims the CI lease itself, keeps the budget
   window and the prior pipeline id on the server (persisted, so a resumed
   pane does not get a fresh budget), and ends on `timeout`, `no_pipeline`,
   `stood_down` or `lease_unavailable` instead of handing the agent a loop.
4. A lease keepalive in the session's MCP server, so a lease stays alive
   through a long fix without the agent heartbeating.
5. A `leaseMrUrl` guard on `git_push` and `mr_retry`: the tool proves this
   session holds the MR's lease (claiming it when free) before it acts.

## Non-goals

- No skill edits, under `plugins/mattstack` or the team packs. Wave 3 rewires
  the skills onto these tools.
- No GitHub CI support (see Decisions).
- No change to `ci-triage.sh`, `ci-forge.sh` or their fixtures; they keep
  running for the skills that call them until wave 3.
- No automatic retry. Retrying an INFRA failure stays an agent decision made
  on `ci_triage`'s output.
- No new daemon verbs and no glance changes. Everything here builds on the
  daemon verbs that exist today.
- No CLI change. `rt ci watch`'s flags are declared in `lib/command-tree-def.ts`,
  outside this lane's fence, and its owner falls back to `user:<login>`, which
  the keepalive is not designed for. `rt ci watch` keeps today's behaviour.
- No `run_budget` dependency. The watch budget is a wall-clock window per MR
  and commit that must work with no run at all (board doctor panes, a bare
  watch), so it lives beside the CI lease, not in the run database.

## Anti-goals (a failure even if it technically works)

- An empty or partial triage that reads as a clean pipeline. Any forge
  failure is a tool error, never an empty report.
- A tool that opens a gate, acts on a spent budget, or picks an answer.
- A team-specific rule (a job name, a pattern, a path) written into rt.
- A board doctor in board mode claiming a lease.
- Breaking a skill that is installed today: a current skill calling
  `ci_watch` without the new input must see exactly today's behaviour.

## Decisions

Made by Matt through the herd gate:

1. **Lease during a long fix: server keepalive.** Once `ci_watch` (attending)
   or a `leaseMrUrl` guard holds this session's lease, the session's rt MCP
   server heartbeats it every minute on a timer while that server process
   lives. It stops 60 minutes after the last such CI call on that MR, on
   release, or when another owner holds the lease. The TTL stays 600 s, so a
   crashed session's lease goes stale within 10 minutes and the doctor can
   take over.
2. **GitHub: GitLab only this wave.** `ci_watch` v2, `ci_triage` and
   `pipeline_jobs` return a structured `unsupported_forge` result on a GitHub
   PR, so the skill's `gh` path takes over. The lease, the keepalive and the
   `leaseMrUrl` guard work on GitHub PR URLs too (they are file-based).
   GitHub CI parity is its own later lane.
3. **CI conflict: regenerate the reference and bump the plugin.** This PR
   regenerates `plugins/mattstack/attachments/mcp-tools/reference.md` and
   bumps `plugins/mattstack/.claude-plugin/plugin.json`'s patch version (a
   generated file and the manifest, no skill text), so the plugin-mattstack
   job can go green. A sibling lane's bump that conflicts at merge takes the
   higher version and regenerates.

My calls (Matt can overturn any of them on review):

4. **`ci_watch` v2 is opt-in with `attend: true`.** Without it, `ci_watch`
   behaves exactly as today, so installed skills, which route on today's
   states (`lease_lost`, `running` with `budget.spent`, repeated `waiting`),
   keep working. Wave 3 skills pass `attend: true`. Replacing the default
   would hand today's skills states their graphs do not draw.
5. **`ci_triage` has no ref input.** It triages the pipeline it is given, or
   the MR's current head pipeline when none is given. Resolving "the newest
   pipeline for a branch" is the `--ref` hazard, so it does not exist.
6. **Config comes as `configPath` or inline `config`**, one schema with the
   same keys as the packs' `ci-config.json`. Packs keep their files; wave 3
   swaps the bash line for a tool call naming the same file.
7. **The new tools declare `shellForms: {none: ...}` this wave.** A string
   form such as `ci-triage.sh` becomes a strict skills-lint rule, and today's
   skills still call the script, so the plugin job would fail. Wave 3 adds
   the forms when it removes the scripts from the skills.
8. **No-pipeline window: 10 minutes**, matching today's "two waiting results
   in a row" at the default 300 s wait.
9. **Base windows also drop `parent_pipeline` pipelines.** GitLab lists child
   pipelines under their parent's ref, so the script's filter (schedule and
   external only) lets children take base-window slots and fewer real base
   pipelines get compared. This is the one deliberate departure from the
   script's rules; no fixture exercises it.
10. **POSIX bracket classes are refused.** Patterns compile as JavaScript
    regular expressions; `[[:digit:]]` would compile and silently match
    something else, so a pattern containing `[[:` is a tool error naming it.
    No pack config uses one today.
11. **A trace read failure is UNCLEAR, not a tool error.** The trace verb
    returns one flat error string, so the job stays in the report as UNCLEAR
    with `traceAvailable: false` and the error text. The report never drops
    the job, so it cannot read as clean; a broken forge already fails the
    earlier pipeline and job reads.

## Constraints

- **Write fence**: `lib/mcp/ci-tools.ts`, `lib/ci/**`,
  `lib/mcp/mr-read-tools.ts`, the `mr_retry` handler in `lib/mcp/tools.ts`
  (the `leaseMrUrl` parameter only), `lib/mcp/git-tools.ts` (the `leaseMrUrl`
  parameter only; the git-guards lane owns the rest), `commands/ci.ts`, this
  spec and its plan, and the `__tests__` beside them. Decision 3 adds
  `plugins/mattstack/attachments/mcp-tools/reference.md` and
  `plugins/mattstack/.claude-plugin/plugin.json`.
- **Every tool on the server runs with no permission prompt** on every estate
  machine (`.claude/rules/mcp-and-gates.md`). Each new input is a grant: a
  caller-named path is confined, an MR URL is validated, and every result
  passes through `callTool`'s redaction.
- **The owner is always this session** (`ownerFromEnv`, from
  `CLAUDE_CODE_SESSION_ID`). No tool takes an owner input.
- **Never claim under the board doctor's lease.** With `underBoardLease`,
  `ci_watch` only reads the lease and never claims, re-claims, heartbeats or
  starts a keepalive.
- **Purity**: no employer names, team slugs or ticket ids in code, tests,
  fixtures or the PR. Tests that need team-shaped patterns use the existing
  example fixture.
- Run tests from the worktree root, targeted files only (`AGENTS.md`).

## Design

### 1. Triage engine: `lib/ci/triage.ts`

A pure port of `ci-triage.sh` over a small forge interface, so the GitLab
adapter and a fixture adapter drive the same code.

**Forge interface** (`TriageForge`), each method async:

- `pipelinesForRef(ref, limit)`: rows `{id, status, webUrl}` newest first,
  with `schedule` and `external` sources dropped before the limit applies;
  `null` when the ref is unknown.
- `pipelineInfo(id)`: `{id, status, webUrl, sha, ref}`, or `null` when the
  pipeline does not exist.
- `failedJobs(id)`: rows `{pipelineId, jobId, name, stage, status,
  allowFailure, attempt}` for the pipeline and its same-project children, or
  `null` when the pipeline does not exist; plus cross-project bridge rows
  (section 2).
- `trace(jobId)`: the raw trace, or `null` when it cannot be read.
- `defaultBranch()`: the project's default branch, or `null`.
- `infraPatterns()`: forge-specific INFRA patterns.

Any other forge failure (auth, network, a 5xx) throws, and the throw ends the
triage as a tool error.

**Inputs**: `{pipelineId, targetBranch, base?, noBase?, config}`.

**Rules ported verbatim from the script:**

- REAL and INFRA defaults are the script's two lists, unchanged. Config
  arrays (`real-patterns`, `infra-patterns`, `noisy-jobs`) extend them; they
  never replace them. The forge's `infraPatterns()` extends INFRA too.
- Scalars resolve input, then config, then default: `base-depth` (default 3),
  `base-ref`, `skip-base`. `noBase: true` or `skip-base: true` turns the base
  comparison off.
- Each trace is ANSI-stripped (SGR sequences, as the script's `sed`), then:
  - REAL hits: lines kept by the exclusion filter (a lowercased line with a
    nonzero `N failed` or `N error` count is kept; otherwise a line holding
    `passed` or a zero count is dropped; every other line is kept), matched
    against the REAL patterns, first 5.
  - INFRA hits: every line matched against the INFRA patterns, first 3.
  - Verdict: REAL if any REAL hit, else INFRA if any INFRA hit, else UNCLEAR.
    A trace that cannot be read is UNCLEAR with `traceAvailable: false` and
    `traceError`, never INFRA, and never dropped.
- Patterns are compiled as JavaScript regular expressions, matched per line,
  case-sensitive (as `grep -E`). A pattern that does not compile, or that
  holds a POSIX bracket class (`[[:`), is a tool error naming it.
- A job is noisy only when it is `allow_failure` and its name contains a
  `noisy-jobs` entry (substring, not pattern).
- **Ownership**, unless the base comparison is off:
  - Base ref: input `base`, then config `base-ref`, then the MR's target
    branch, then the forge's default branch, then `master`. The default
    branch is appended as a second ref when it differs.
  - Per base ref: `pipelinesForRef(ref, depth + 1)`, drop the pipeline under
    triage, keep the first `depth`, and read each one's failed jobs. A
    pipeline whose jobs cannot be read is skipped and not counted as scanned.
    A ref with no pipelines is skipped.
  - A failed job is INHERITED when a scanned base pipeline has a failed job
    with exactly the same name (string equality, never a pattern), with the
    refs it fails on; yours when none does; UNKNOWN when the comparison is off
    or no base pipeline was scanned, with the reason.

**Output** (`TriageReport`):

```
pipeline: {id, status, webUrl, sha, ref}
base: {refs: string[], scanned: number, off: boolean}
blocking: JobVerdict[]        // allow_failure false
nonBlocking: JobVerdict[]     // allow_failure true
crossProject: BridgeRow[]     // section 2
summary: {blocking, blockingYours, blockingInherited, blockingUnknown,
          nonBlocking, noisy: string[], allInfraBlocking: boolean}
```

`JobVerdict` is `{jobId, name, stage, pipelineId, attempt, blocking, noisy,
verdict, ownership, ownershipNote, inheritedOn, realHits, infraHits,
traceAvailable, traceError?, traceTail}`. `ownership` is `yours`, `INHERITED` or `UNKNOWN`;
`ownershipNote` carries the script's wording (`not failing on base`, `also
failing on <refs>`, `base comparison off`, `no base pipelines scanned`).
`traceTail` is the last 40 lines. `allInfraBlocking` is true only when there
is at least one blocking job, every blocking verdict is INFRA, and no
cross-project bridge is blocking. Nothing is written to disk; the script's
per-job log files become `traceTail`, and `mr_job_trace` reads more.

### 2. GitLab adapter and pipeline walk: `lib/ci/gitlab-forge.ts`

Implements `TriageForge` and the `pipeline_jobs` walk over existing daemon
verbs, so nothing shells out and nothing needs glab or jq:

- `pipeline:list {repoName, ref, limit: 20}` for `pipelinesForRef`, filtered
  by `source` (`schedule`, `external` and `parent_pipeline` dropped, Decision
  9) and then cut to the limit (the script's adapter reads 20, too).
- `forge:get` for `pipelineInfo` (`/projects/:id/pipelines/<id>`; a 404 is
  `null`, any other non-2xx throws), the
  default branch (`/projects/:id`), and the walk: `/projects/:id/pipelines/
  <id>/jobs` (with `include_retried`) and `/projects/:id/pipelines/<id>/
  bridges`, paged. A page that comes back truncated (the 256 KiB cap) is
  re-read with a smaller page size; one still truncated at the smallest size
  is an error, never a silent short list.
- `mr:fetch-job-trace {repoName, iid, jobId}` for traces.
- `mr:get` supplies the MR's target branch, head pipeline, web URL and forge.

The walk recurses into a bridge's downstream pipeline only when it is in the
same project, and marks every row under an `allow_failure` bridge, or under a
bridge that is already `success` while its child failed, as non-blocking
(the rule glance's `collectFailedJobs` uses; the shell adapter did not do
this). A failed bridge whose downstream is in another project becomes a
`BridgeRow {name, status, blocking, downstream: {projectId, pipelineId,
webUrl}}` with no trace: its jobs are not triaged, and the row is the signal
that something outside the report failed. `attempt` is 1 plus the number of
earlier retried runs of the same job name in that pipeline (GitLab marks them
`retried`); only the latest run of each job is reported.

`infraPatterns()` returns GitLab's own `registry.gitlab.com.*error`, the
pattern the mattstack GitLab adapter emits today.

### 3. `ci_triage` tool (in `lib/mcp/ci-tools.ts`)

**Input**: the MR target (`repoName` and `iid`, or `mrUrl`), `pipelineId?`
(the number in `gitlab:pipeline:N`; default the MR's head pipeline),
`configPath?` or `config?` (not both), `base?`, `noBase?`.

- `configPath` is confined with `checkReadRootPath` and
  `readRootsForThisProcess` (the Claude Code temp root or an installed plugin
  or pack root), then parsed as JSON. Unknown keys (`description`, `timeout`)
  are ignored; a known key of the wrong type is an error.
- On a GitHub PR it returns `{state: "unsupported_forge", forge: "github",
  next}` before any GitLab-only read.
- Otherwise it returns `{state: "triaged", ...TriageReport, next}`, where
  `next` names `mr_job_trace` for more log and `mr_retry {jobId}` for a retry,
  and says the retry decision is the caller's.
- Trace reads run a few at a time and ping progress, so a large pipeline
  stays under the MCP idle timeout.

### 4. `pipeline_jobs` tool (in `lib/mcp/mr-read-tools.ts`)

**Input**: the MR target, `pipelineId?` (default the head pipeline),
`scope?` (one GitLab job scope: `failed`, `success`, `running`, `pending`,
`manual`, `canceled`, `skipped`, `created`), `name?` (substring).

**Output**: `{state: "listed", pipeline, jobs, bridges}`. `jobs` rows are
`{jobId, name, stage, status, allowFailure, blocking, pipelineId, attempt,
webUrl}` across the pipeline and its same-project children; `bridges` lists
every bridge with its downstream and a `crossProject` flag. GitHub returns
`unsupported_forge` as above. It replaces the adapter's `jobs <id>` verb.

### 5. `ci_watch` v2: `attend: true`

New inputs: `attend` (boolean) and `holder` (`watch-ci` or `doctor`,
default `watch-ci`, only with `attend`). Every existing input keeps its
meaning. Without `attend` nothing changes.

**Lease, each poll:**

- `underBoardLease`: read only. A fresh lease owned by the board doctor
  continues; anything else is `stood_down {holder}` (the lease, or null).
- Otherwise heartbeat this session's lease. When this session holds no lease
  (none on disk, or a stale one), claim it with `holder` and the MR's source
  branch. The first claim of a watch is free; a claim after this session
  already held the lease for this commit is a re-claim, at most 2 per commit.
- A fresh lease held by another owner, at claim or at heartbeat, is
  `stood_down {holder}`.
- A claim that throws (lock busy, a filesystem fault) is `lease_unavailable
  {error}`; a third vanishing after 2 re-claims is `lease_unavailable` with
  that reason.
- An attending watch (not under the board lease) starts or touches the
  keepalive (section 6).

**Persisted watch state**: one JSON file per MR at
`<ciLeaseDir()>/watch/<lease file name>`, written atomically (temp file and
rename). Only the MR's current attendant writes it: a call whose poll proved
this session's own lease, or, under `underBoardLease`, a fresh board doctor
lease. A call that ends `stood_down` or `lease_unavailable` never writes, so
a session and a doctor cannot overwrite each other's window; the lease
already makes them exclusive. Fields: the commit being watched, its matched
pipeline id and last seen status, its budget minutes, its proven prior
pipeline id, when it was first seen waiting, whether this session held the
lease, the re-claim count, and the time of the last write. A new commit
replaces the state, carrying the old commit's last head pipeline id forward
as the new commit's prior pipeline id. An unreadable or malformed file reads
as no state. The directory keeps the lease folder's `*.json` scan
(`readCiLeaseByBranch`) free of non-lease files.

**Budget window**: still measured from the watched pipeline's `createdAt`.
`budgetMinutes` resolves input, then the persisted value for this commit,
then the `ci.watch.budgetMinutes` setting. `extendMinutes` and `freshWindow`
work as today, and the minutes they settle on are persisted, so later calls
and a resumed pane need not pass them. A retry is detected without
`mr_retry`'s help: when the persisted status of the matched pipeline was
`failed` or `canceled` and the pipeline is running again (a job or pipeline
retry, from a tool or the GitLab UI), a fresh window opens as `freshWindow`
does. Detection keys on the last result, not the pipeline's status, because
a blocking job usually fails while the pipeline still runs: when the last
result for the matched pipeline was `failed` (settled or early) and the
pipeline now shows no failed blocking job and has not settled, a retry
happened and the window reopens. A settled `failed` or `canceled` pipeline
running again (a whole-pipeline retry) reopens it the same way.

**Prior pipeline id**: input, then the persisted value for this commit, then
the id carried from the previous commit.

**States with `attend`:**

| State | Meaning |
|---|---|
| `success`, `success_with_warnings`, `failed`, `canceled`, `skipped`, `manual` | settled, as today (`failed` also on an early blocking failure) |
| `running`, `waiting` | call again, as today |
| `timeout` | the pipeline is still running past the budget; carries `budget` |
| `no_pipeline` | 10 minutes of `waiting` for this commit with no pipeline for it; carries `pushed` and `remoteSha` (below) |
| `superseded`, `aborted` | as today |
| `stood_down` | another owner attends; carries `holder` |
| `lease_unavailable` | the lease could not be claimed or kept; carries `error` |
| `unsupported_forge` | a GitHub PR; carries `forge` |

The no-pipeline clock starts at the first `waiting` result for this commit
and is persisted. `waiting` comes in two kinds: the MR head is at the commit
but no pipeline for it exists yet (`pushed: true`, `remoteSha` the commit),
or GitLab reports no head at all (`pushed: false`, `remoteSha: null`). A head
at a different commit is not waiting: it ends `superseded` after today's
2-minute grace, as now, carrying the head it saw. The clock resets when a
pipeline for the commit appears.

`lease_lost` is never returned with `attend`. The result keeps today's other
fields (`pipeline`, `failedJobs`, `blockingFailures`, `lease`, `budget`,
`priorPipelineId`, `next`).

### 6. Lease keepalive: `lib/ci/lease-keepalive.ts`

A process-wide registry of `{mrUrl, owner, lastTouch}` and one timer that
starts with the first entry, fires every 60 s, and is `unref`'d so it never
keeps a CLI process alive. Each tick heartbeats every entry and drops an
entry when its heartbeat reports `lost` or `none`, or when `lastTouch` is
more than 60 minutes old. A busy lock keeps the entry for the next tick. An
attending `ci_watch` call and a `leaseMrUrl` guard touch an entry;
`ci_lease_release` by this session drops it. `ci_lease_claim` and
`ci_lease_heartbeat` do not start one (Decision 1 names only the watch and
the guard). Clock and timer are injectable for tests.

### 7. The `leaseMrUrl` guard: `lib/ci/lease-guard.ts`

`ensureLease(mrUrl, env, {branch?})`:

1. Validate the URL with `isHttpsMrUrl` and the owner with `ownerFromEnv`;
   either failing is a tool error.
2. Heartbeat this session's lease; held means proceed.
3. Otherwise read the lease. A fresh lease of another owner, the board
   doctor's included, refuses: `{refused: "lease_held", holder}`. The guard
   never claims under a fresh foreign lease.
4. Otherwise claim it (`holder: watch-ci`, with `branch` when known). A claim
   that loses a race refuses as in 3; a claim that throws is a tool error.
5. Held or claimed touches the keepalive.

**`git_push {leaseMrUrl?}`**: after the tree guard and before the push; the
branch is the tree's current branch. A refusal returns `ok({pushed: false,
refused: "lease_held", holder})`. Only the `leaseMrUrl` property, its check
and the handler plumbing change in `git-tools.ts`.

**`mr_retry {leaseMrUrl?}`**: before the retry. A refusal returns
`ok({retried: false, refused: "lease_held", holder})`. Only the property and
the guard call change in the `mr_retry` handler.

A refusal is a result, not an error, so a graph can route on `refused`.
Callers that do not pass `leaseMrUrl` (every installed skill today) see no
change. The guard does not check that the URL is the tree's MR; the caller
names it.

### 8. Plugin reference (Decision 3)

Regenerate `reference.md` with `bun cli.ts mcp tools --json | bun
plugins/mattstack/scripts/gen-mcp-tools.ts`, and bump `plugin.json`'s patch
version, as the last change before the push.

## Testing

**Conformance with the shell suite.** A fixture adapter in the tests reads
the existing scenario files in place under
`plugins/mattstack/attachments/pipeline/stage-watch-ci/tests/fixtures/`
(read-only), with the fake adapter's semantics: `pipelines-<ref>.tsv`
filtered unless all sources, `info-<id>` status lines, `jobs-<id>.tsv`,
`trace-<jid>.txt`, `target-branch-<ref>.txt`, `infra-patterns.txt`, and a
per-test default branch standing in for the cwd's `origin/HEAD`. Where a
shell case passed `--ref <r>`, the test resolves the head pipeline from that
ref's file and the target branch from its target-branch file, which is what
the tool gets from the MR. Every case below has a TS twin:

- Verdicts: `real-verdict`, `infra-verdict`, `unclear-verdict`,
  `real-beats-infra`, `exclusion-filter-lower`, `exclusion-filter-mixed`,
  `exclusion-keeps-mixed`, `exclusion-keeps-zero-errors`, `ansi-real`,
  `ansi-stripped` (no ESC byte in any hit or tail), `infra-hits-alongside-real`,
  `header-weburl`, `blocking-section` and `nonblocking-section` (the two
  arrays).
- Errors: `bogus-pipeline-*` (a tool error, no report), `adapter-fail-*`
  (a throwing forge is a tool error carrying its message).
- Ownership and config: `inherited`, `yours`, `config-real-extends`,
  `noisy-flag`, `schedule-excluded-from-window`, `no-base-flag` and its
  clean twin, `base-flag-overrides`, `base-lookup-failed`, `self-excluded`,
  `unknown-when-no-base-pipelines`, `infra-patterns-appended`,
  `example-fixture-noisy`, `example-fixture-infra`, `default-branch-fallback`
  (no default branch falls back to `master`),
  `ownership-index-ere-metachar`, `pipeline-and-ref-together`.

Shell-only cases with no twin, and why: the `ff-*` self-checks test the shell
fake (the TS fixture adapter gets its own small checks), `trace-files` (no
files are written), `no-pipeline-for-ref` and `all-sources-fallback` (there
is no ref mode; a test covers "no `pipelineId` means the MR's head
pipeline"), `missing-forge` and `usage-rc64` (no adapter path or argv; schema
validation replaces them), `env-skip` (no environment knobs; `noBase` is
covered).

**Unit tests**: pattern compilation errors, config validation (types,
unknown keys ignored, `configPath` outside the read roots refused), the
GitLab adapter over a fake `rtCommand` (paging, truncation retry, same-project
recursion, optional-bridge inheritance, cross-project bridge rows, `attempt`),
`ci_watch` with `attend` over the existing fake deps (each new state, first
claim free, re-claim limit, stand-down under a fresh foreign lease, board
mode never claims, state persisted and reloaded by a second call, a new
commit carrying the prior id, retry detection opening a window, extension
persisted, `no_pipeline` after 10 minutes), the keepalive (tick heartbeats,
idle drop, lost drop, busy lock kept, release drops), the guard (held,
claimed, refused for a foreign fresh lease and for the board doctor's,
claim race, throws), and `git_push`/`mr_retry` with and without `leaseMrUrl`.

**Must stay green**: `lib/mcp/__tests__/ci-tools.test.ts`,
`lib/mcp/__tests__/no-ci-lease-stdio.test.ts`,
`lib/mcp/__tests__/tools.test.ts`, `lib/ci/__tests__/watch.test.ts`, the
shell suite itself (`bash plugins/mattstack/attachments/pipeline/
stage-watch-ci/tests/test-ci-triage.sh`), `bun run check` and `bun run
purity`.

## Left to the builder

- File split inside `lib/ci/` beyond the files named here, and type names.
- Trace concurrency (a small number) and how progress is pinged.
- Page sizes for `forge:get` and the truncation fallback steps.
- Exact `next` wording and tool description text (keep descriptions short;
  each is read by every agent).
- Whether `pipeline_jobs` shares the walk code with the adapter directly or
  through a helper.
- How the watch state file's write is staged, as long as it is atomic.
